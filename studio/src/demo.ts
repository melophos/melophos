// plays a song as a person might: close to the beat but never exactly on it, with one slip that is then corrected.
// the script is plain data and the player is polled from the frame loop, so the demo runs on the master clock like
// everything else. it drives the same note handler a MIDI keyboard does, so the demo shows the real scoring rather
// than a recording. a run driven by this is always labelled as simulated and never saved as progress.
import { beatMs, excerpt, type Excerpt } from "./piece";
import type { Song } from "./songs";

export interface DemoPress {
  // milliseconds from the start of the run
  atMs: number;
  note: number;
  on: boolean;
}

export function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// the presses of one run, in time order. speed scales time and leaves the notes where they are
export function demoScript(song: Song, choice: Excerpt = { hand: "both" }, speed = 1, seed = 7): DemoPress[] {
  const random = seeded(seed);
  const notes = excerpt(song, choice);
  const first = notes[0]?.startBeat ?? 0;
  const ms = beatMs(song.tempo, speed);
  const presses: DemoPress[] = [];
  const slipAt = Math.floor(notes.length / 3);
  notes.forEach((n, i) => {
    // one wrong neighbouring key a third of the way in, quickly corrected and placed inside the gap before the note
    const base = 400 + (n.startBeat - first) * ms;
    if (i === slipAt && n.note < 108) {
      presses.push({ atMs: base - 260, note: n.note + 1, on: true }, { atMs: base - 120, note: n.note + 1, on: false });
    }
    const at = base + (random() - 0.5) * 100;
    presses.push({ atMs: at, note: n.note, on: true }, { atMs: at + Math.max(120, n.beats * ms * 0.7), note: n.note, on: false });
  });
  return presses.sort((a, b) => a.atMs - b.atMs);
}

export const demoLengthMs = (script: readonly DemoPress[]): number => (script.at(-1)?.atMs ?? 0) + 200;

export class DemoPlayer {
  private next = 0;

  constructor(
    private readonly script: readonly DemoPress[],
    // the clock time at which the script's zero falls
    private readonly originMs: number,
  ) {}

  get done(): boolean {
    return this.next >= this.script.length;
  }

  // everything due by this time, each handed out once
  poll(nowMs: number): DemoPress[] {
    const out: DemoPress[] = [];
    while (this.next < this.script.length && (this.script[this.next]?.atMs ?? Infinity) + this.originMs <= nowMs) {
      out.push(this.script[this.next]!);
      this.next += 1;
    }
    return out;
  }

  // the clock time a press falls on, so its timestamp matches what a real keyboard would give
  timeOf(press: DemoPress): number {
    return this.originMs + press.atMs;
  }
}
