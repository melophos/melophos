// the scoring engine from core/, built to WebAssembly. every figure a player is shown (accuracy, hits, timing) comes
// from here and nowhere else, so the browser and the terminal give the same score for the same performance.
// the module loads once, on first use and a failure to load is a state the interface can show, never a crash.
import { Follower, follow, init, type FollowConfig, type FollowEvent, type FollowSummary, type Note, type Session } from "@melophos/core";
import wasmUrl from "@melophos/core/melophos_core_wasm_bg.wasm?url";

export type ScoringStatus = "idle" | "loading" | "ready" | "failed";

let status: ScoringStatus = "idle";
let loading: Promise<void> | null = null;
let failure = "";

export const scoringStatus = (): ScoringStatus => status;
export const scoringFailure = (): string => failure;

// loads the module. safe to call many times: the work is done once
export function loadScoring(): Promise<void> {
  if (status === "ready") return Promise.resolve();
  if (loading) return loading;
  status = "loading";
  loading = init(wasmUrl).then(
    () => {
      status = "ready";
    },
    (error: unknown) => {
      status = "failed";
      failure = error instanceof Error ? error.message : "The scoring module could not be loaded.";
      loading = null;
      throw error;
    },
  );
  return loading;
}

// for tests that load the bytes themselves
export function markScoringReady(): void {
  status = "ready";
  loading = Promise.resolve();
}

// what the Studio tells the engine about a run so it need not guess: the hand or hands practised and (in the engine's own
// Session) where the learner starts from and every jump. times are counted from the start of the stretch, so the start is 0.
// the engine uses the hands to keep the other hand's notes from being matched and the jumps to read a replay as a replay
export interface RunContext {
  practise: "both" | "left" | "right";
}

const sessionFor = (c: RunContext | undefined, jumps: { beforePress: number; toMs: number }[] = []): Session => ({ startMs: 0, practise: c?.practise ?? "both", ...(jumps.length ? { jumps } : {}) });

// what the Studio makes of one press. the engine may be unsure and then the press is shown neutrally and counts neither for
// nor against the player. every reading of an engine event goes through verdictOf, so a new kind of outcome lands here
export type Verdict = "right" | "wrong" | "unsure";

export function verdictOf(event: { kind: string }): Verdict {
  switch (event.kind) {
    case "hit":
    case "late":
    // a press that plays again a note already played, which is what a replay after Repeat or Next phrase gives, is right for
    // the note it repeats. an extra strike of a key that is not being replayed shows the same and builds nothing
    case "repeat":
      return "right";
    case "wrong":
      return "wrong";
    default:
      // "unsure" or any outcome this Studio does not know is shown neutrally and counted neither way
      return "unsure";
  }
}

// the figures of a summary the page may show. a field the engine does not give yet is zero
export function notJudgedOf(summary: object): number {
  const n = (summary as { unsure?: unknown; notJudged?: unknown }).notJudged ?? (summary as { unsure?: unknown }).unsure;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export interface ExpectedNote {
  tMs: number;
  note: number;
  // the hand that plays the note. the engine uses it to tell which hands were played, so practising one hand of a
  // two-hand piece is scored on that hand and a missing hand is not counted as missed notes
  hand?: "left" | "right";
}

// what one press changed: its own event and any earlier events the engine now reads differently
export interface LivePush {
  event: FollowEvent;
  changes: { before: FollowEvent | undefined; after: FollowEvent }[];
  // presses before this index are final and are never read differently again
  settled: number;
}

// the live scorer as the session uses it. the engine's reading of a performance can step back and rewrite earlier presses,
// so every update carries what changed and nothing may assume the place only moves forward
export interface LiveScorer {
  push(atMs: number, note: number): LivePush;
  free(): void;
}

// one pass through a passage. presses go in as they happen and the summary is read at the end
export class Scorer implements LiveScorer {
  private readonly follower: Follower;
  private last = 0;
  readonly events: FollowEvent[] = [];
  private closed = false;

  constructor(expected: readonly ExpectedNote[], config?: FollowConfig, context?: RunContext) {
    this.follower = new Follower(
      expected.map((n) => ({ tMs: Math.max(0, Math.round(n.tMs)), note: n.note, ...(n.hand ? { hand: n.hand } : {}) })),
      config,
      sessionFor(context),
    );
  }

  // presses must arrive in time order, so one that arrives early by a hair is held at the last time
  push(atMs: number, note: number): LivePush {
    const press: Note = { tMs: Math.max(this.last, Math.round(atMs)), note };
    this.last = press.tMs;
    const { event, revised, settled } = this.follower.push(press);
    const changes: LivePush["changes"] = [];
    for (const r of revised) {
      changes.push({ before: this.events[r.playedIndex], after: r });
      this.events[r.playedIndex] = r;
    }
    this.events[event.playedIndex] = event;
    return { event, changes, settled };
  }

  get speedPpm(): number {
    return this.follower.speedPpm;
  }

  finish(): FollowSummary {
    return this.follower.finish();
  }

  free(): void {
    if (this.closed) return;
    this.closed = true;
    this.follower.free();
  }
}

// one stretch of a run: from the start or from a repeat or a new lap, to where the player had got to. only the notes that were
// reached go in, so notes never reached are never counted as missed
export interface RunSegment {
  expected: ExpectedNote[];
  presses: { tMs: number; note: number }[];
  // how long the stretch lasted in milliseconds
  lengthMs: number;
}

export interface RunScore {
  summary: FollowSummary;
  // presses the engine was not sure about. zero until the engine says so
  notJudged: number;
  // the keys that were expected and not played, by key
  missed: Map<number, number>;
}

// the gap put between stretches. it is longer than the engine's pause, so it re-reads the player's place at each one
const SEGMENT_GAP_MS = 30_000;

// scores a whole run once, with every stretch laid end to end, so the figures are the engine's and they add up
export function scoreRun(segments: readonly RunSegment[], config?: FollowConfig, context?: RunContext): RunScore | { problem: string } | null {
  const expected: Note[] = [];
  const presses: Note[] = [];
  const owner: number[] = [];
  let base = 0;
  // every stretch after the first begins with a jump, which the engine is told about: before this press, play goes on from here
  const jumps: { beforePress: number; toMs: number }[] = [];
  for (const seg of segments) {
    if (expected.length > 0 && seg.presses.length > 0) jumps.push({ beforePress: presses.length, toMs: base + Math.max(0, Math.round(seg.expected[0]?.tMs ?? 0)) });
    for (const n of seg.expected) {
      expected.push({ tMs: base + Math.max(0, Math.round(n.tMs)), note: n.note, ...(n.hand ? { hand: n.hand } : {}) });
      owner.push(n.note);
    }
    // presses must arrive in time order, so one that is a hair early is held at the one before it
    let last = base;
    for (const p of seg.presses) {
      last = Math.max(last, base + Math.max(0, Math.round(p.tMs)));
      presses.push({ tMs: last, note: p.note });
    }
    const end = Math.max(seg.lengthMs, ...seg.expected.map((n) => n.tMs), ...seg.presses.map((p) => p.tMs), 0);
    base += Math.round(end) + SEGMENT_GAP_MS;
  }
  if (expected.length === 0) return null;
  try {
    const result = follow(expected, presses, config, sessionFor(context, jumps));
    const matched = new Set<number>();
    for (const e of result.events) if ((e.kind === "hit" || e.kind === "late") && e.expectedIndex !== null) matched.add(e.expectedIndex);
    const missed = new Map<number, number>();
    owner.forEach((note, i) => {
      if (!matched.has(i)) missed.set(note, (missed.get(note) ?? 0) + 1);
    });
    return { summary: result.summary, missed, notJudged: notJudgedOf(result.summary) };
  } catch (error) {
    // the engine refused the run, for example a bad jump or a hand with no labelled notes. the reason is passed on in words
    return { problem: error instanceof Error ? error.message : "The engine refused this run." };
  }
}

// the window widens when the piece is slowed, since a slow beat leaves more room around each note
export function configFor(_speed: number, mode: "melody" | "rhythm" | "listen" = "rhythm"): FollowConfig {
  // Melody waits for the player, so timing is not judged there: the window is as wide as the engine allows and nothing is late
  if (mode === "melody") return { windowMs: 10_000 };
  // everywhere else the engine judges timing against the player's own tempo with its own window, so nothing is changed here
  return {};
}

// timing is only reported in Rhythm mode and rounded to 10 ms, because the measurement is good to about a frame
export function roundTiming(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 10) * 10;
}
