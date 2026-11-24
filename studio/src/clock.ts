// the master clock for a piece. position is always a pure function of clock time, never a count of frames or timers,
// so the lane, the lights, the scoring and the sound all read one answer. the time source is injected: the app gives
// it performance.now() and the tests give it a number they move by hand.
//
// time is in milliseconds. position is in beats at the written tempo, so a slower speed stretches time and leaves the
// notes where they are. a negative position is the count-in.
import { beatMs } from "./piece";

export interface Loop {
  // beats from the start of the piece. the loop covers fromBeat up to but not including toBeat
  fromBeat: number;
  toBeat: number;
}

export interface Scheduled {
  // the index of the note in the list given or -1 for a metronome click
  index: number;
  // the clock time to sound it
  atMs: number;
  // true for the first beat of a bar, which the metronome accents
  accent: boolean;
  kind: "note" | "click";
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 1.25;

export const clampSpeed = (speed: number): number => Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));

export class Transport {
  private running = false;
  // the clock time at which the raw beat was anchorBeat
  private anchorMs = 0;
  private anchorBeat = 0;
  private speedValue = 1;
  private loopValue: Loop | null = null;

  constructor(
    readonly tempo: number,
    private readonly now: () => number,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get speed(): number {
    return this.speedValue;
  }

  get loop(): Loop | null {
    return this.loopValue;
  }

  setLoop(loop: Loop | null): void {
    if (loop && !(loop.toBeat > loop.fromBeat)) throw new RangeError("a loop must end after it starts");
    // keep the player where they are in the piece when the loop changes
    const here = this.running ? this.rawBeat(this.now()) : this.anchorBeat;
    this.loopValue = loop;
    this.anchorBeat = here;
    this.anchorMs = this.now();
  }

  setSpeed(speed: number): void {
    const t = this.now();
    this.anchorBeat = this.running ? this.rawBeat(t) : this.anchorBeat;
    this.anchorMs = t;
    this.speedValue = clampSpeed(speed);
  }

  // starts the piece at a beat, with an optional count-in before it
  start(fromBeat = 0, countInBeats = 0): void {
    this.anchorBeat = fromBeat - countInBeats;
    this.anchorMs = this.now();
    this.running = true;
  }

  pause(): void {
    if (!this.running) return;
    this.anchorBeat = this.rawBeat(this.now());
    this.running = false;
  }

  resume(): void {
    if (this.running) return;
    this.anchorMs = this.now();
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.anchorBeat = 0;
  }

  // the beat the clock has reached counting every lap, so it never jumps back
  rawBeat(t: number): number {
    if (!this.running) return this.anchorBeat;
    return this.anchorBeat + (t - this.anchorMs) / beatMs(this.tempo, this.speedValue);
  }

  // the place in the piece, with the loop applied
  position(t: number = this.now()): number {
    return this.wrap(this.rawBeat(t)).beat;
  }

  // how many times the loop has come round
  lap(t: number = this.now()): number {
    return this.wrap(this.rawBeat(t)).lap;
  }

  private wrap(raw: number): { beat: number; lap: number } {
    const loop = this.loopValue;
    if (!loop || raw < loop.toBeat) return { beat: raw, lap: 0 };
    const length = loop.toBeat - loop.fromBeat;
    const past = raw - loop.fromBeat;
    const lap = Math.floor(past / length);
    return { beat: loop.fromBeat + (past - lap * length), lap };
  }

  // the clock time at which a beat of the piece sounds in a given lap
  timeOf(beat: number, lap = 0): number {
    const length = this.loopValue ? this.loopValue.toBeat - this.loopValue.fromBeat : 0;
    const raw = beat + lap * length;
    return this.anchorMs + (raw - this.anchorBeat) * beatMs(this.tempo, this.speedValue);
  }

  // everything due to sound from one time up to another, nearest first. the app calls this every frame with a window a
  // little ahead of now and a note is handed out once because the windows do not overlap
  due(notes: readonly { startBeat: number }[], fromMs: number, toMs: number, beatsPerBar: number, click: boolean): Scheduled[] {
    if (!this.running) return [];
    const out: Scheduled[] = [];
    const loop = this.loopValue;
    const first = this.rawBeat(fromMs);
    const last = this.rawBeat(toMs);
    const length = loop ? loop.toBeat - loop.fromBeat : 0;
    const lapFrom = loop && first >= loop.toBeat ? Math.floor((first - loop.fromBeat) / length) : 0;
    const lapTo = loop && last >= loop.toBeat ? Math.floor((last - loop.fromBeat) / length) : 0;
    for (let lap = lapFrom; lap <= lapTo; lap++) {
      const offset = lap * length;
      notes.forEach((n, index) => {
        if (loop) {
          const inside = n.startBeat >= loop.fromBeat && n.startBeat < loop.toBeat;
          // a note before the loop is heard on the way in. a note after it is never reached. a note inside comes round
          if (lap === 0 ? n.startBeat >= loop.toBeat : !inside) return;
        }
        const raw = n.startBeat + (loop && lap > 0 ? offset : 0);
        if (raw >= first && raw < last) out.push({ index, atMs: this.timeOf(n.startBeat, lap), accent: false, kind: "note" });
      });
      if (click) {
        const from = Math.max(first, Math.ceil(first));
        for (let b = from; b < last; b += 1) {
          const beat = loop && b >= loop.toBeat ? loop.fromBeat + ((b - loop.fromBeat) % length) : b;
          const inLap = loop && b >= loop.toBeat ? Math.floor((b - loop.fromBeat) / length) : 0;
          if (inLap !== lap) continue;
          out.push({ index: -1, atMs: this.timeOf(beat, lap), accent: ((Math.round(beat) % beatsPerBar) + beatsPerBar) % beatsPerBar === 0, kind: "click" });
        }
      }
    }
    return out.sort((a, b) => a.atMs - b.atMs);
  }
}

// maps the performance clock to the audio clock so a sound can be placed on the audio timeline. the two drift apart a
// little, so the pair is read again every frame rather than once
export interface AudioClockLike {
  currentTime: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
}

export function audioTimeFor(ctx: AudioClockLike, performanceMs: number, nowMs: number): number {
  const stamp = ctx.getOutputTimestamp?.();
  const contextTime = stamp?.contextTime ?? ctx.currentTime;
  const performanceTime = stamp?.performanceTime ?? nowMs;
  return Math.max(0, contextTime + (performanceMs - performanceTime) / 1000);
}
