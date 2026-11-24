// one practice run, outside React. it owns the clock, the stepper, the scoring engine, the keyboard lights, the lane and
// the sound and it tells the interface what changed through a small snapshot. the interface draws words and buttons
// from the snapshot. the lane and the keyboard are updated here directly, because they change every frame or every
// press and React does not need to know.
import { Transport, audioTimeFor } from "../clock";
import { DemoPlayer, demoLengthMs, demoScript } from "../demo";
import { LatencyProbe } from "../latency";
import { noteLabel, spokenName, type NameOptions } from "../notes";
import { Practice } from "../practice";
import { barCount, barOf, beatMs, beatsPerBar, excerpt, groupsOf, layout, type HandChoice, type TimedNote } from "../piece";
import { speak } from "../speech";
import { Scorer, type LiveScorer, type RunContext, configFor, roundTiming, scoreRun, scoringStatus, verdictOf, type RunSegment } from "../scoring";
import type { Hand, Song } from "../songs";
import type { Synth } from "../audio";
import type { FollowConfig } from "@melophos/core";
import type { ExpectedNote } from "../scoring";
import type { LapScore, SessionRecord } from "../app/store";
import type { Mode } from "../app/types";
import type { Cue, KeyboardView } from "./keyboard-view";
import type { Lane } from "./lane";

export type Status = "ready" | "counting" | "playing" | "paused" | "finished";

export const PHRASE_BARS = 4;
// how far ahead of now sound is handed to the audio clock
const LOOKAHEAD_MS = 120;

export interface SessionConfig {
  song: Song;
  mode: Mode;
  hand: HandChoice;
  fromBar: number | null;
  toBar: number | null;
  // 0.25 to 1.25
  speed: number;
  loop: boolean;
  // a simulated player drives the run. it is always labelled and never saved
  simulated: boolean;
  guidance: "steps" | "lane";
  metronome: boolean;
  wrongSound: boolean;
  keySound: boolean;
  // no sound at all: nothing is unlocked, no count-in click and no tone. the rhythm game is silent unless the player turns sound on
  silent: boolean;
  spoken: boolean;
  // allow a voice that sends the words to the browser's speech service
  onlineVoice: boolean;
  reducedMotion: boolean;
  names: NameOptions;
  calibrationMs: number | null;
  lightSensitivity: boolean;
}

export interface NextNote {
  note: number;
  label: string;
  spoken: string;
  hand: Hand;
  finger: number | null;
  // due at the same moment as the first note, so shown with it as one chord or one two-hand step
  together: boolean;
}

export interface Snapshot {
  version: number;
  status: Status;
  mode: Mode;
  simulated: boolean;
  // Melody mode is waiting for the player
  waiting: boolean;
  // beats of count-in left or null
  countIn: number | null;
  bar: number;
  beat: number;
  beatsPerBar: number;
  phraseIndex: number;
  phraseCount: number;
  phraseFromBar: number;
  phraseToBar: number;
  next: NextNote[];
  doneNotes: number;
  totalNotes: number;
  lastEvent: { kind: "right" | "wrong" | "unsure"; label: string; expected: string | null } | null;
  wrongPresses: number;
  firstTime: number;
  lap: number;
  notice: string | null;
  // said once at the start of a phrase and when the player asks
  announcement: string;
  // goes up each time the announcement is said, so the same words said again are a change the reader will speak
  announcementId: number;
  scoringReady: boolean;
  result: SessionRecord | null;
}

// the words for what is next, for the text line a screen reader reads
export function describeNext(next: readonly NextNote[]): string {
  const first = next[0];
  if (!first) return "Nothing more to play.";
  const now = next.filter((n) => n.together);
  const later = next.filter((n) => !n.together).slice(0, 3);
  const twoHands = new Set(next.slice(0, 4).map((n) => n.hand)).size > 1;
  const who = (n: NextNote): string => (twoHands ? `${n.spoken}, ${n.hand} hand` : n.spoken);
  const finger = (n: NextNote): string => (n.finger ? `, finger ${n.finger}` : "");
  const head = now.length > 1 ? `together, ${now.map(who).join(" and ")}` : `${who(first)}${twoHands ? "" : `, ${first.hand} hand`}${finger(first)}`;
  return later.length ? `Next: ${head}. Then ${later.map(who).join(", ")}.` : `Next: ${head}.`;
}

export function phraseInfo(song: Song, fromBar: number, toBar: number, bar: number): { index: number; count: number; fromBar: number; toBar: number } {
  const total = Math.max(1, toBar - fromBar + 1);
  const count = Math.ceil(total / PHRASE_BARS);
  const index = Math.min(count - 1, Math.max(0, Math.floor((bar - fromBar) / PHRASE_BARS)));
  const start = fromBar + index * PHRASE_BARS;
  void song;
  return { index, count, fromBar: start, toBar: Math.min(toBar, start + PHRASE_BARS - 1) };
}

// the visual beat indicator changes at most this often, so it can never be a flash
export const MAX_INDICATOR_RATE = 2.5;

export const beatsPerSecond = (tempo: number, speed: number): number => (tempo * speed) / 60;
export const indicatorByBar = (tempo: number, speed: number): boolean => beatsPerSecond(tempo, speed) > MAX_INDICATOR_RATE;

export interface Deps {
  keyboard: KeyboardView;
  lane: Lane | null;
  synth: Synth;
  probe?: LatencyProbe | undefined;
  now?: (() => number) | undefined;
  // lets a test give the session a scorer of its own
  makeScorer?: ((expected: ExpectedNote[], config: FollowConfig, context: RunContext) => LiveScorer) | undefined;
}

// one stretch of a run: from the start or from a repeat or a new lap
interface Seg {
  fromBeat: number;
  // the clock time of fromBeat. unknown in Melody mode until the player's first press, because the player decides when to begin
  originMs: number | null;
  presses: { tMs: number; note: number }[];
}

export class PracticeSession {
  private readonly cfg: SessionConfig;
  private readonly deps: Deps;
  private readonly now: () => number;
  private readonly notes: TimedNote[];
  private readonly groups: TimedNote[][];
  private readonly perBar: number;
  private readonly firstBar: number;
  private readonly lastBar: number;
  private readonly transport: Transport;
  private practice: Practice;
  // the live scorer of the stretch in hand, for the feedback on each press in Rhythm mode. the figures in the summary come
  // from scoring the whole run once at the end, so a repeat or a loop cannot upset them
  private scorer: LiveScorer | null = null;
  private seg: Seg | null = null;
  private closed: RunSegment[] = [];
  private melodyStats = { total: 0, firstTime: 0, missed: new Map<number, number>() };
  private liveHits = 0;
  private lapCount = 0;
  // the live scorer's reading of each press of the stretch, kept up to date as the engine revises earlier ones
  private segEvents = new Map<number, { kind: string; expectedIndex: number | null; playedIndex: number }>();
  // wrong presses whose spoken message waits for the engine to make them final
  private wrongWaiting: { playedIndex: number; expected: number }[] = [];
  private shown: { playedIndex: number; note: number } | null = null;
  // where the player jumped to with Repeat phrase or Next phrase, told to the engine with the hands and the start
  private jumps: { toBeat: number }[] = [];
  private unsure = 0;
  private lastWrongAnnouncedAt = -Infinity;
  private hit = new Set<number>();
  private wrongPresses = 0;
  private bestRun = 0;
  private run = 0;
  private demo: DemoPlayer | null = null;
  private frameId = 0;
  private status: Status = "ready";
  private startedAtIso = "";
  private startedMs = 0;
  private scheduledUntil = 0;
  private lastCueSignature = "";
  private listenCursor = 0;
  private lastLap = 0;
  private lastPhrase = -1;
  private lastEvent: Snapshot["lastEvent"] = null;
  private notice: string | null = null;
  private announcement = "";
  private announceId = 0;

  private say(text: string): void {
    this.announcement = text;
    this.announceId += 1;
  }
  private result: SessionRecord | null = null;
  private wake: WakeLockSentinel | null = null;
  private snapshot: Snapshot;
  private version = 0;
  private lastSnapshotKey = "";
  private readonly listeners = new Set<() => void>();
  private readonly onVisibility = (): void => {
    if (document.hidden && (this.status === "playing" || this.status === "counting")) this.pause("The tab was hidden, so the piece paused.");
  };

  constructor(config: SessionConfig, deps: Deps) {
    this.cfg = config;
    this.deps = deps;
    this.now = deps.now ?? (() => performance.now());
    this.perBar = beatsPerBar(config.song);
    this.firstBar = config.fromBar ?? 1;
    this.lastBar = config.toBar ?? barCount(config.song);
    this.notes = excerpt(config.song, { hand: config.hand, fromBar: this.firstBar, toBar: this.lastBar });
    this.groups = groupsOf(this.notes);
    this.practice = new Practice(config.song, { hand: config.hand, fromBar: this.firstBar, toBar: this.lastBar });
    this.transport = new Transport(config.song.tempo, this.now);
    if (config.loop && config.mode !== "melody") this.transport.setLoop({ fromBeat: (this.firstBar - 1) * this.perBar, toBeat: this.lastBar * this.perBar });
    this.transport.setSpeed(config.speed);
    this.snapshot = this.build();
    deps.lane?.setNotes(this.notes, this.perBar);
    deps.lane?.setMode(config.reducedMotion ? "page" : "scroll");
    this.refreshGuidance(true);
    this.markLane();
    document.addEventListener("visibilitychange", this.onVisibility);
    // the sound stopping under a running piece pauses it and says why
    deps.synth.onLost = () => this.lose("Sound stopped, so the piece paused. Press Resume to carry on.");
  }

  // something the piece depends on has gone: the keyboard or the sound. the piece pauses and the reason is shown
  lose(reason: string): void {
    if (this.status === "playing" || this.status === "counting") this.pause(reason);
  }

  // ---- what the interface reads

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private publish(): void {
    const next = this.build();
    const key = JSON.stringify({ ...next, version: 0 });
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.snapshot = { ...next, version: ++this.version };
    for (const l of this.listeners) l();
  }

  private position(): number {
    return this.cfg.mode === "melody" ? (this.groups[this.practice.position]?.[0]?.startBeat ?? this.endBeat()) : this.transport.position();
  }

  private endBeat(): number {
    return this.notes.reduce((end, n) => Math.max(end, n.startBeat + n.beats), 0);
  }

  private nextNotes(): NextNote[] {
    const detail = this.cfg.mode === "melody" ? this.practice.upcomingDetail(4) : this.pending().slice(0, 4);
    const head = detail[0]?.startBeat;
    return detail.map((n) => ({ note: n.note, label: noteLabel(n.note, this.nameOptions()), spoken: spokenName(n.note, this.nameOptions()), hand: n.hand, finger: n.finger ?? null, together: n.startBeat === head }));
  }

  private nameOptions(): NameOptions {
    return { ...this.cfg.names, key: this.cfg.song.key };
  }

  private build(): Snapshot {
    const pos = this.status === "ready" && this.cfg.mode !== "melody" ? (this.notes[0]?.startBeat ?? 0) : this.position();
    const bar = Math.min(this.lastBar, Math.max(this.firstBar, barOf(this.cfg.song, Math.max(0, pos))));
    const phrase = phraseInfo(this.cfg.song, this.firstBar, this.lastBar, bar);
    const beatInBar = Math.floor(((pos % this.perBar) + this.perBar) % this.perBar + 0.0001) + 1;
    const counting = this.status === "counting" && pos < 0;
    return {
      version: this.version,
      status: this.status,
      mode: this.cfg.mode,
      simulated: this.cfg.simulated,
      waiting: this.cfg.mode === "melody" && this.status === "playing",
      countIn: counting ? Math.ceil(-pos - 0.0001) : null,
      bar,
      beat: beatInBar,
      beatsPerBar: this.perBar,
      phraseIndex: phrase.index,
      phraseCount: phrase.count,
      phraseFromBar: phrase.fromBar,
      phraseToBar: phrase.toBar,
      next: this.status === "finished" ? [] : this.nextNotes(),
      doneNotes: this.cfg.mode === "melody" ? this.notes.length - this.practice.groups.slice(this.practice.position).reduce((n, g) => n + g.length, 0) : this.hit.size,
      totalNotes: this.notes.length,
      lastEvent: this.lastEvent,
      wrongPresses: this.wrongPresses,
      firstTime: this.practice.summary().firstTime,
      lap: this.transport.lap(),
      notice: this.notice,
      announcement: this.announcement,
      announcementId: this.announceId,
      scoringReady: scoringStatus() === "ready",
      result: this.result,
    };
  }

  // ---- the lights, the lane and the words

  // the notes still to play, in order, for Rhythm and Listen
  private pending(): TimedNote[] {
    const pos = this.transport.position();
    const from = pos - 0.6;
    // the notes are in time order, so the search starts where it could matter and stops after a dozen. a long
    // imported piece costs no more per frame than a short one
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.notes[mid]?.startBeat ?? 0) < from) lo = mid + 1;
      else hi = mid;
    }
    const out: TimedNote[] = [];
    for (let i = lo; i < this.notes.length && out.length < 12; i++) {
      const n = this.notes[i]!;
      if (!this.hit.has(n.index)) out.push(n);
    }
    return out;
  }

  private cues(): Cue[] {
    const out: Cue[] = [];
    if (this.status === "finished") return out;
    if (this.cfg.mode === "melody") {
      const detail = this.practice.upcomingDetail(8);
      const dueNow = new Set(this.practice.due);
      const firstGroupBeat = this.groups[this.practice.position]?.[0]?.startBeat;
      const seenGroups = new Set<number>();
      for (const n of detail) {
        const isNext = n.startBeat === firstGroupBeat && dueNow.has(n.note);
        if (!isNext) seenGroups.add(n.startBeat);
        if (seenGroups.size > 2) break;
        out.push({ note: n.note, hand: n.hand, role: isNext ? "next" : "soon" });
      }
      return out;
    }
    const pending = this.pending();
    const grouped = groupsOf(pending);
    grouped.slice(0, 3).forEach((g, i) => {
      for (const n of g) out.push({ note: n.note, hand: n.hand, role: i === 0 ? "next" : "soon" });
    });
    return out;
  }

  // sets the lights and the lane. cheap when nothing changed
  private refreshGuidance(force = false): void {
    const cues = this.cues();
    const signature = cues.map((c) => `${c.note}${c.hand}${c.role}`).join("|");
    if (force || signature !== this.lastCueSignature) {
      this.lastCueSignature = signature;
      this.deps.keyboard.setCues(cues);
      const first = cues.find((c) => c.role === "next");
      if (first) this.deps.keyboard.follow(first.note);
      // in Melody mode nothing is waiting on a beat, so the next note can be said aloud
      if (first && this.cfg.spoken && this.cfg.mode === "melody" && this.status === "playing") {
        const said = cues.filter((c) => c.role === "next").map((c) => spokenName(c.note, this.nameOptions())).join(" and ");
        // only a voice that runs on this device is used, unless the player has allowed an online one
        speak(said, this.cfg.onlineVoice);
      }
    }
  }

  // what the lane shows besides the position only changes when a note is played, so it is set then and not every frame
  private laneSignature = "";

  private markLane(): void {
    const lane = this.deps.lane;
    if (!lane) return;
    const signature = `${this.cfg.mode === "melody" ? `${this.practice.position}:${this.practice.due.length}` : this.hit.size}|${this.snapshot.bar}|${this.status}`;
    if (signature !== this.laneSignature) {
      this.laneSignature = signature;
      const done = this.cfg.mode === "melody" ? this.melodyDone() : this.hit;
      lane.setDone(done);
      const current = new Set<number>();
      const firstGroup = this.cfg.mode === "melody" ? this.groups[this.practice.position] : groupsOf(this.pending())[0];
      for (const n of firstGroup ?? []) if (!done.has(n.index)) current.add(n.index);
      lane.setCurrent(current);
      if (this.cfg.reducedMotion || (this.cfg.guidance === "lane" && this.cfg.mode === "melody")) {
        const phrase = phraseInfo(this.cfg.song, this.firstBar, this.lastBar, this.snapshot.bar);
        lane.setPage((phrase.fromBar - 1) * this.perBar, phrase.toBar * this.perBar);
      }
    }
    lane.draw(this.cfg.reducedMotion ? 0 : this.position());
  }

  private melodyDone(): Set<number> {
    const done = new Set<number>();
    for (let g = 0; g < this.practice.position; g++) for (const n of this.groups[g] ?? []) done.add(n.index);
    // notes already pressed inside a chord that is not yet complete
    const due = new Set(this.practice.due);
    for (const n of this.groups[this.practice.position] ?? []) if (!due.has(n.note)) done.add(n.index);
    return done;
  }

  private announcePhrase(force = false): void {
    const s = this.build();
    if (!force && s.phraseIndex === this.lastPhrase) return;
    this.lastPhrase = s.phraseIndex;
    const heads = this.notes.filter((n) => n.startBeat >= (s.phraseFromBar - 1) * this.perBar - 0.001).slice(0, 4);
    const names = heads.map((n) => spokenName(n.note, this.nameOptions())).join(", ");
    this.say(`Phrase ${s.phraseIndex + 1} of ${s.phraseCount}, bars ${s.phraseFromBar} to ${s.phraseToBar}. Starts with ${names || "no notes"}.`);
  }

  // the text for the "what is next" button
  whatIsNext(): string {
    this.say(describeNext(this.nextNotes()));
    this.publish();
    return this.announcement;
  }

  // ---- control

  start(): void {
    if (this.status === "playing" || this.status === "counting") return;
    if (this.status === "finished") this.reset();
    if (!this.cfg.silent) void this.deps.synth.unlock();
    this.startedMs = this.now();
    this.startedAtIso = new Date().toISOString();
    this.notice = null;
    this.result = null;
    void this.acquireWake();
    const startBeat = (this.firstBar - 1) * this.perBar;
    if (this.cfg.mode === "melody") {
      this.status = "playing";
      this.openSegment(this.groups[0]?.[0]?.startBeat ?? startBeat, null);
      if (this.cfg.simulated) this.demo = new DemoPlayer(demoScript(this.cfg.song, { hand: this.cfg.hand, fromBar: this.firstBar, toBar: this.lastBar }, this.cfg.speed), this.now());
    } else {
      this.transport.start(startBeat, this.perBar);
      this.status = "counting";
      this.scheduledUntil = this.now();
      this.openSegment(startBeat, this.transport.timeOf(startBeat));
      if (this.cfg.simulated && this.cfg.mode === "rhythm") {
        const first = this.notes[0]?.startBeat ?? startBeat;
        this.demo = new DemoPlayer(demoScript(this.cfg.song, { hand: this.cfg.hand, fromBar: this.firstBar, toBar: this.lastBar }, this.cfg.speed), this.transport.timeOf(first) - 400);
      }
    }
    this.lastPhrase = -1;
    this.announcePhrase(true);
    this.begin();
  }

  private begin(): void {
    cancelAnimationFrame(this.frameId);
    this.frameId = requestAnimationFrame(this.frame);
    this.refreshGuidance(true);
    this.markLane();
    this.publish();
  }

  pause(reason: string | null = null): void {
    if (this.status !== "playing" && this.status !== "counting") return;
    this.transport.pause();
    this.status = "paused";
    this.notice = reason;
    cancelAnimationFrame(this.frameId);
    this.deps.synth.suspend();
    this.releaseWake();
    this.publish();
  }

  resume(): void {
    if (this.status !== "paused") return;
    if (!this.cfg.silent) void this.deps.synth.unlock();
    this.notice = null;
    if (this.cfg.mode !== "melody") {
      this.transport.resume();
      this.scheduledUntil = this.now();
    }
    this.status = this.cfg.mode !== "melody" && this.transport.position() < 0 ? "counting" : "playing";
    void this.acquireWake();
    this.begin();
  }

  toggle(): void {
    if (this.status === "playing" || this.status === "counting") this.pause();
    else if (this.status === "paused") this.resume();
    else this.start();
  }

  // the player ends the run early. it is scored for what was played
  stop(): void {
    if (this.status === "ready" || this.status === "finished") return;
    this.finish();
  }

  restart(): void {
    cancelAnimationFrame(this.frameId);
    this.reset();
    this.refreshGuidance(true);
    this.markLane();
    this.publish();
  }

  private reset(): void {
    this.scorer?.free();
    this.scorer = null;
    this.seg = null;
    this.closed = [];
    this.melodyStats = { total: 0, firstTime: 0, missed: new Map() };
    this.liveHits = 0;
    this.lapCount = 0;
    this.jumps = [];
    this.unsure = 0;
    this.lastWrongAnnouncedAt = -Infinity;
    this.practice = new Practice(this.cfg.song, { hand: this.cfg.hand, fromBar: this.firstBar, toBar: this.lastBar });
    this.transport.stop();
    this.hit.clear();
    this.listenCursor = 0;
    this.laneSignature = "";
    this.wrongPresses = 0;
    this.run = 0;
    this.bestRun = 0;
    this.lastEvent = null;
    this.result = null;
    this.notice = null;
    this.lastLap = 0;
    this.demo = null;
    this.status = "ready";
    this.deps.keyboard.setWrong(null);
    this.releaseWake();
  }

  // hands-free: back to the start of this phrase
  repeatPhrase(): void {
    this.seekPhrase(this.snapshot.phraseIndex);
  }

  nextPhrase(): void {
    this.seekPhrase(Math.min(this.snapshot.phraseCount - 1, this.snapshot.phraseIndex + 1));
  }

  private seekPhrase(index: number): void {
    const fromBar = this.firstBar + index * PHRASE_BARS;
    const beat = (fromBar - 1) * this.perBar;
    this.jumps.push({ toBeat: beat });
    // the stretch so far is closed with what was reached and a new one opens here with its own scorer and its own clock
    if (this.seg) this.closeSegment();
    if (this.cfg.mode === "melody") {
      this.retirePractice();
      this.practice.seekToBeat(beat);
      this.openSegment(this.groups[this.practice.position]?.[0]?.startBeat ?? beat, null);
    } else {
      this.transport.start(beat, 0);
      this.scheduledUntil = this.now();
      this.lastLap = 0;
      this.openSegment(beat, this.transport.timeOf(beat));
    }
    for (const n of this.notes) {
      if (n.startBeat >= beat - 0.001) this.hit.delete(n.index);
      else this.hit.add(n.index);
    }
    this.listenCursor = 0;
    this.lastPhrase = -1;
    this.announcePhrase(true);
    this.refreshGuidance(true);
    this.markLane();
    this.publish();
  }

  // opens the next stretch of the run
  private openSegment(fromBeat: number, originMs: number | null): void {
    this.seg = { fromBeat, originMs, presses: [] };
    this.segEvents = new Map();
    this.wrongWaiting = [];
    this.shown = null;
    this.scorer?.free();
    this.scorer = null;
    if (this.cfg.mode !== "rhythm" || scoringStatus() !== "ready") return;
    const ms = beatMs(this.cfg.song.tempo, this.cfg.speed);
    // the live scorer reads the notes from here on, with times counted from here, to match the presses
    const expected = this.notes.filter((n) => n.startBeat >= fromBeat - 0.001).map((n) => ({ tMs: (n.startBeat - fromBeat) * ms, note: n.note, hand: n.hand }));
    this.scorer = (this.deps.makeScorer ?? ((e, c, x) => new Scorer(e, c, x)))(expected, configFor(this.cfg.speed, "rhythm"), this.context());
  }

  // the three facts the engine may want: where the learner started, the hands practised and every jump
  private context(): RunContext {
    return { practise: this.cfg.hand };
  }

  // the stretch ends where the player had got to. only the notes reached go into the score
  private closeSegment(reachedBeat?: number): void {
    const seg = this.seg;
    this.seg = null;
    this.scorer?.free();
    this.scorer = null;
    if (!seg) return;
    const ms = beatMs(this.cfg.song.tempo, this.cfg.speed);
    const loop = this.transport.loop;
    let reached: TimedNote[];
    if (this.cfg.mode === "melody") {
      reached = this.practice.reachedNotes();
    } else {
      const to = reachedBeat ?? this.transport.position();
      reached = this.notes.filter((n) => n.startBeat >= seg.fromBeat - 0.001 && n.startBeat <= to + 0.001 && (!loop || n.startBeat < loop.toBeat - 0.001));
    }
    if (reached.length === 0 && seg.presses.length === 0) return;
    const origin = seg.originMs ?? 0;
    void origin;
    this.closed.push({
      expected: reached.map((n) => ({ tMs: (n.startBeat - seg.fromBeat) * ms, note: n.note, hand: n.hand })),
      presses: seg.presses,
      lengthMs: (reached.at(-1) ? (reached.at(-1)!.startBeat - seg.fromBeat) * ms : 0) + 1000,
    });
  }

  // Melody keeps its own counts for each stretch, because a repeat starts the stepping again
  private retirePractice(): void {
    const p = this.practice.summary();
    this.melodyStats.total += this.practice.reachedNotes().length;
    this.melodyStats.firstTime += p.firstTime;
    for (const [note, count] of this.practice.missedNotes) this.melodyStats.missed.set(note, (this.melodyStats.missed.get(note) ?? 0) + count);
    this.practice = new Practice(this.cfg.song, { hand: this.cfg.hand, fromBar: this.firstBar, toBar: this.lastBar });
  }

  // ---- input

  // a key goes down or up. the time is the event's own, on the performance clock
  input(note: number, on: boolean, atMs: number, source: "midi" | "screen" | "computer" | "demo"): void {
    const { keyboard, synth } = this.deps;
    keyboard.setHeld(note, on);
    if (!on) return;
    // sound for keys with no sound of their own: the screen, the computer keyboard and the simulated player
    if (!this.cfg.silent && this.cfg.keySound && source !== "midi" && synth.running) synth.tone(note, synth.at(atMs, this.now()), 0.5);
    if (this.status !== "playing" && this.status !== "counting") return;
    if (this.cfg.mode === "listen") return;

    const adjust = source === "midi" && this.cfg.calibrationMs !== null ? this.cfg.calibrationMs : 0;
    const at = atMs - adjust;
    if (this.cfg.mode === "melody") {
      this.stepMelody(note, at);
    } else {
      this.scoreRhythm(note, at);
    }
    this.refreshGuidance();
    this.markLane();
    this.publish();
  }

  private stepMelody(note: number, at: number): void {
    const seg = this.seg;
    // the clock for scoring starts at the first press, because the player decides when to begin
    if (seg && seg.originMs === null) seg.originMs = at;
    const result = this.practice.play(note, at);
    if (!result) return;
    seg?.presses.push({ tMs: at - (seg.originMs ?? at), note });
    this.afterPress(result.correct, note, result.expected);
    if (this.practice.finished) this.finish();
  }

  private scoreRhythm(note: number, at: number): void {
    const seg = this.seg;
    if (!seg || this.transport.position(at) < -0.5) return;
    seg.presses.push({ tMs: at - (seg.originMs ?? at), note });
    if (!this.scorer) {
      // with no scoring module the keys are still checked, by a plainer rule: a key is right when it is one of the notes due next
      const due = groupsOf(this.pending())[0] ?? [];
      const found = due.find((n) => n.note === note);
      if (found) {
        this.hit.add(found.index);
        this.afterPress(true, note, note);
      } else {
        this.afterPress(false, note, due[0]?.note ?? null);
      }
      return;
    }
    let pushed;
    try {
      pushed = this.scorer.push(at - (seg.originMs ?? at), note);
    } catch (error) {
      // the engine refused the run: a bad jump or a hand with no labelled notes. say so in words and carry on with the plain rule
      this.scorer?.free();
      this.scorer = null;
      this.notice = `The scoring engine could not follow this run (${error instanceof Error ? error.message : "it gave no reason"}), so each key is now checked by a plainer rule and there will be no accuracy figure.`;
      this.scoreRhythm(note, at);
      return;
    }
    const { event, changes, settled } = pushed;
    // the live scorer counts from the start of this stretch, so its index is turned back into the piece's own
    const first = this.notes.findIndex((n) => n.startBeat >= seg.fromBeat - 0.001);
    const isHit = (e: { kind: string; expectedIndex: number | null } | undefined): e is { kind: string; expectedIndex: number } => e !== undefined && verdictOf(e) === "right" && e.expectedIndex !== null;
    // the engine can read earlier presses differently and its place can step back, so every change is applied: first what is
    // taken back, then what is newly read
    for (const c of changes) if (isHit(c.before)) this.hit.delete(first + c.before.expectedIndex);
    for (const c of changes) if (isHit(c.after)) this.hit.add(first + c.after.expectedIndex);
    this.segEvents.set(event.playedIndex, event);
    for (const c of changes) {
      this.segEvents.set(c.after.playedIndex, c.after);
      this.followWithdrawal(c.before, c.after);
    }
    const verdict = verdictOf(event);
    this.shown = { playedIndex: event.playedIndex, note };
    // each press clears the mark of the one before it
    this.deps.keyboard.setUnsure(null);
    if (isHit(event)) {
      this.hit.add(first + event.expectedIndex);
      // a replayed note is right for the note it repeats and builds no run, since it was already counted
      this.afterPress(true, note, note, event.kind !== "repeat");
    } else if (verdict === "wrong") {
      const expected = this.pending()[0]?.note ?? null;
      this.afterPress(false, note, expected, true, false);
      // the cross and the words show at once and are taken back if the engine reads the press differently. the spoken message
      // waits until the press is final, because speech cannot be taken back
      if (expected !== null) this.wrongWaiting.push({ playedIndex: event.playedIndex, expected });
    } else {
      // the engine is not sure: the press is shown neutrally and builds nothing and breaks nothing
      this.unsure += 1;
      this.deps.keyboard.setUnsure(note);
      this.lastEvent = { kind: "unsure", label: noteLabel(note, this.nameOptions()), expected: null };
    }
    this.speakSettledWrongs(settled);
  }

  // the wrong presses the engine has now made final and still calls wrong are announced, at the usual rate
  private speakSettledWrongs(settled: number): void {
    const keep: { playedIndex: number; expected: number }[] = [];
    for (const w of this.wrongWaiting) {
      if (w.playedIndex >= settled) {
        keep.push(w);
        continue;
      }
      // final: if it is still wrong it is announced and if it was read differently nothing is ever said
      const e = this.segEvents.get(w.playedIndex);
      if (e && verdictOf(e) === "wrong") this.announceWrong(w.expected);
    }
    this.wrongWaiting = keep;
  }

  private announceWrong(expected: number): void {
    const t = this.now();
    if (t - this.lastWrongAnnouncedAt < 2000) return;
    const same = this.announcement.startsWith("Wrong");
    this.say(`${same ? "Wrong again" : "Wrong"}. Still ${spokenName(expected, this.nameOptions())}.`);
    this.lastWrongAnnouncedAt = t;
  }

  // a press that was shown wrong and is now read as right or not judged is withdrawn: the cross and the words go
  private followWithdrawal(before: { kind: string } | undefined, after: { kind: string; playedIndex: number }): void {
    const was = before ? verdictOf(before) : null;
    const now = verdictOf(after);
    if (was === "wrong" && now !== "wrong") this.wrongPresses = Math.max(0, this.wrongPresses - 1);
    if (was !== "wrong" && now === "wrong") this.wrongPresses += 1;
    if (this.shown?.playedIndex === after.playedIndex && was !== now) {
      const label = noteLabel(this.shown.note, this.nameOptions());
      if (was === "wrong") this.deps.keyboard.setWrong(null);
      this.deps.keyboard.setUnsure(now === "unsure" ? this.shown.note : null);
      this.lastEvent = { kind: now, label, expected: null };
    }
  }

  private afterPress(correct: boolean, note: number, expected: number | null, counts = true, announce = true): void {
    const names = this.nameOptions();
    if (correct) {
      if (counts) {
        this.run += 1;
        this.liveHits += 1;
        this.bestRun = Math.max(this.bestRun, this.run);
      }
      this.deps.keyboard.setWrong(null);
      this.lastEvent = { kind: "right", label: noteLabel(note, names), expected: null };
      // a right note clears the old "wrong" so the reader is not left holding it
      if (this.announcement.startsWith("Wrong")) this.say("");
    } else {
      this.run = 0;
      this.wrongPresses += 1;
      this.deps.keyboard.setWrong(note);
      if (this.cfg.wrongSound && !this.cfg.silent) this.deps.synth.wrong();
      this.lastEvent = { kind: "wrong", label: noteLabel(note, names), expected: expected === null ? null : noteLabel(expected, names) };
      // a blind player is told which note is still expected, once in a while: at most one message every two seconds, so quick playing never floods the reader
      if (announce && expected !== null) this.announceWrong(expected);
    }
  }

  // ---- the frame loop

  private frame = (ts: number): void => {
    this.frameId = 0;
    if (this.status !== "playing" && this.status !== "counting") return;
    // the frame that follows a press is where the press is drawn, so the probe closes its samples here
    this.pendingStamps.splice(0).forEach((stamp) => this.deps.probe?.record(stamp, ts));
    const now = this.now();
    if (this.demo) {
      for (const p of this.demo.poll(now)) this.input(p.note, p.on, this.demo.timeOf(p), "demo");
    }
    if (this.cfg.mode !== "melody") this.tickTimed(now);
    if (this.status === "playing" || this.status === "counting") {
      if (this.cfg.mode === "melody" || !this.cfg.reducedMotion) this.markLane();
      this.announcePhrase();
      this.publish();
      this.frameId = requestAnimationFrame(this.frame);
    }
  };

  // times of presses waiting for the next drawn frame
  private readonly pendingStamps: number[] = [];

  // the diagnostic view asks for a sample for each press
  stamp(eventTimeStamp: number): void {
    this.pendingStamps.push(eventTimeStamp);
  }

  private tickTimed(now: number): void {
    const pos = this.transport.position(now);
    if (this.status === "counting" && pos >= 0) this.status = "playing";
    const lap = this.transport.lap(now);
    if (lap !== this.lastLap) {
      // a lap came all the way round: it is closed whole and the next one opens with a fresh scorer
      this.closeSegment(Infinity);
      this.lastLap = lap;
      this.lapCount += 1;
      this.hit.clear();
      this.listenCursor = 0;
      const from = this.transport.loop?.fromBeat ?? 0;
      this.openSegment(from, this.transport.timeOf(from, lap));
    }
    // sound is handed to the audio clock a little ahead of time. a note or click is handed out once
    const synth = this.deps.synth;
    if (synth.running && !this.cfg.silent) {
      const upTo = now + LOOKAHEAD_MS;
      const wantClick = this.cfg.metronome || pos < 0;
      const due = this.transport.due(this.notes, this.scheduledUntil, upTo, this.perBar, wantClick);
      for (const d of due) {
        const when = audioTimeFor({ currentTime: synth.now() }, d.atMs, now);
        if (d.kind === "click") synth.click(when, d.accent);
        else if (this.cfg.mode === "listen") {
          const n = this.notes[d.index];
          if (n) synth.tone(n.note, when, n.beats * beatMs(this.cfg.song.tempo, this.cfg.speed) / 1000);
        }
      }
      this.scheduledUntil = upTo;
    }
    if (this.cfg.mode === "listen") {
      while (this.listenCursor < this.notes.length && (this.notes[this.listenCursor]?.startBeat ?? Infinity) <= pos) this.hit.add(this.notes[this.listenCursor++]!.index);
    }
    this.refreshGuidance();
    if (!this.transport.loop && pos > this.endBeat() + 1) this.finish();
  }

  // ---- finishing

  private finish(): void {
    cancelAnimationFrame(this.frameId);
    this.transport.pause();
    this.closeSegment();
    let melodyTotal = this.melodyStats.total;
    let melodyFirst = this.melodyStats.firstTime;
    const melodyMissed = new Map(this.melodyStats.missed);
    if (this.cfg.mode === "melody") {
      const p = this.practice.summary();
      melodyTotal += this.practice.reachedNotes().length;
      melodyFirst += p.firstTime;
      for (const [note, count] of this.practice.missedNotes) melodyMissed.set(note, (melodyMissed.get(note) ?? 0) + count);
    }
    // the whole run is scored once, by the engine, with every stretch laid end to end
    const raw = this.cfg.mode === "listen" || scoringStatus() !== "ready" ? null : scoreRun(this.closed, configFor(this.cfg.speed, this.cfg.mode), this.context());
    const scored = raw && "summary" in raw ? raw : null;
    const scoreProblem = raw && "problem" in raw ? raw.problem : null;
    const s = scored?.summary;
    const score: LapScore | null = s
      ? {
          expected: s.playedExpected,
          hits: s.hits,
          late: s.late,
          misses: s.misses,
          wrong: s.wrong,
          repeats: s.repeats,
          accuracy: s.playedAccuracy,
          timingMs: this.cfg.mode === "rhythm" && this.cfg.calibrationMs !== null ? roundTiming(s.meanTimingErrorMs) : null,
          notJudged: scored?.notJudged ?? 0,
        }
      : null;
    const missed = this.cfg.mode === "melody" ? melodyMissed : (scored?.missed ?? new Map<number, number>());
    this.status = "finished";
    const reachedTotal = this.closed.reduce((n, c) => n + c.expected.length, 0);
    this.result = {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `s-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      pieceId: this.cfg.song.id,
      pieceTitle: this.cfg.song.title,
      startedAt: this.startedAtIso || new Date().toISOString(),
      durationMs: Math.max(0, Math.round(this.now() - this.startedMs)),
      mode: this.cfg.mode,
      hand: this.cfg.hand,
      fromBar: this.cfg.fromBar,
      toBar: this.cfg.toBar,
      speedPct: Math.round(this.cfg.speed * 100),
      total: this.cfg.mode === "melody" ? melodyTotal : reachedTotal,
      firstTime: this.cfg.mode === "melody" ? melodyFirst : (s?.hits ?? this.liveHits),
      wrongPresses: score ? score.wrong : this.wrongPresses,
      longestRun: this.bestRun,
      score,
      laps: 1 + this.lapCount,
      ...(scoreProblem ? { scoreProblem } : {}),
      missed: [...missed.entries()].map(([note, count]) => ({ note, count })).sort((a, b) => b.count - a.count || a.note - b.note).slice(0, 128),
    };
    this.deps.keyboard.setCues([]);
    this.deps.lane?.setDone(new Set(this.notes.map((n) => n.index)));
    this.deps.lane?.setCurrent(new Set());
    this.deps.lane?.draw(this.cfg.reducedMotion ? 0 : this.endBeat());
    this.releaseWake();
    this.publish();
  }

  // ---- the screen stays awake while a piece runs

  private async acquireWake(): Promise<void> {
    try {
      if (!navigator.wakeLock || this.wake) return;
      this.wake = await navigator.wakeLock.request("screen");
      this.wake.addEventListener("release", () => {
        this.wake = null;
      });
    } catch {
      // the device or the battery saver refused: the piece still runs
    }
  }

  private releaseWake(): void {
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }

  // the stage for the lane colours: called when the theme changes
  refreshColours(): void {
    this.deps.lane?.refreshColours();
    this.markLane();
  }

  setNames(names: NameOptions): void {
    (this.cfg as { names: NameOptions }).names = names;
    this.publish();
  }

  get lengthMs(): number {
    return demoLengthMs(demoScript(this.cfg.song, { hand: this.cfg.hand }, this.cfg.speed));
  }

  destroy(): void {
    cancelAnimationFrame(this.frameId);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.scorer?.free();
    this.deps.synth.onLost = null;
    this.releaseWake();
    this.deps.keyboard.setCues([]);
    this.deps.keyboard.setWrong(null);
    this.listeners.clear();
  }
}

// every note of a song, for a piece summary
export const noteCount = (song: Song): number => layout(song).length;
