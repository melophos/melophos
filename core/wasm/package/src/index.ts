// typed wrapper around the generated WebAssembly module. the module speaks flat
// typed arrays so nothing is converted on the way in or out. this file checks the
// input, because a typed array silently wraps a bad number into a valid one, turns
// the numbers that come back into objects and turns every failure into a
// ScoringError, whatever was passed in.

import initWasm, {
  initSync as initWasmSync,
  Follower as WasmFollower,
  follow_performance,
  score_passage,
  type InitInput,
  type SyncInitInput,
} from "../pkg/melophos_core_wasm.js";

/** The hand an expected note belongs to, when the song library knows. */
export type Hand = "left" | "right";

/** One key press or one expected note. */
export interface Note {
  /** Milliseconds since the start of the passage, a whole number from 0 to 4 294 967 295. */
  tMs: number;
  /** MIDI note number from 0 to 127. Middle C is 60. */
  note: number;
  /** For an expected note: the hand that plays it. Ignored on a press. */
  hand?: Hand | undefined;
}

/** How the follower is tuned. Anything left out takes the default. */
export interface FollowConfig {
  /**
   * The floor of the timing window, 1 to 10 000. A matched press is in time within this many milliseconds of where the
   * player's own clock expects it or within a quarter of the gap between the notes around it when that is more.
   */
  windowMs?: number;
  /** Chord groups ahead of the player's place a press may be matched to without a search, from 4 to 256. */
  band?: number;
  /** A silence longer than this re-anchors the clock at the next note. */
  pauseMs?: number;
  /** Expected notes this close to the first of a chord form one group. */
  chordMs?: number;
  /** Presses a new place must explain before the reading moves there, from 2 to 8. A search starts one press earlier. */
  relocateAfter?: number;
}

/** A jump the learner asked for: before the press with this index, playing goes on from this written time. */
export interface Jump {
  beforePress: number;
  toMs: number;
}

/**
 * What the caller knows about a session, so the engine need not guess it. Anything left out is unknown: the engine
 * then expects the top of the piece, both hands and no jump and leaves a press unsure until the presses show otherwise.
 */
export interface Session {
  /** The written time the learner starts from. */
  startMs?: number | undefined;
  /** The hand or hands being practised. With one hand named, the other hand's notes are never matched. */
  practise?: Hand | "both" | undefined;
  /** For `follow` only: the jumps the learner asked for (Repeat, Next phrase), in press order. Live, call `jumpTo`. */
  jumps?: readonly Jump[] | undefined;
}

/** The defaults, equal to the ones in the Rust crate. */
export const DEFAULT_CONFIG: Readonly<Required<FollowConfig>> = Object.freeze({
  windowMs: 150,
  band: 16,
  pauseMs: 2500,
  chordMs: 50,
  relocateAfter: 3,
});

/** The most notes in a piece, as in the Rust crate. */
export const MAX_EXPECTED = 100_000;
/**
 * The most presses in one session or one `follow` call: six hours at ten a second.
 * A page that follows this many keeps the module's memory at its peak for the life
 * of the page, since WebAssembly memory never shrinks (about 25 MB, see the README).
 */
export const MAX_PLAYED = 216_000;

/**
 * What a press was. "unsure" is a press the engine cannot place with confidence: show it neutrally. It counts neither
 * for nor against the player.
 */
export type EventKind = "hit" | "wrong" | "late" | "repeat" | "unsure";

/** Which hands the player was found to play, from the hand labels of the expected notes. */
export type PlayedHands = "unknown" | "neither" | "left" | "right" | "both";

/** What the follower decided about one press. */
export interface FollowEvent {
  playedIndex: number;
  kind: EventKind;
  /** Index in the expected notes you gave (null when no note was matched). */
  expectedIndex: number | null;
  /** The chord group the reading has reached. */
  position: number;
  /** Press time minus the expected time on the player's own clock. */
  errorMs: number;
  /** Tempo after this press: 1 000 000 is the written speed. */
  speedPpm: number;
  /** Set when the reading moved to this press by a repeat, a restart or a jump: the group left behind. */
  jumpedFrom: number | null;
}

/** The summary of a whole performance. Every figure is defined in docs/scoring.md. */
export interface FollowSummary {
  expected: number;
  /** Notes matched in time. */
  hits: number;
  /** Notes matched outside the window: played, but not in time. */
  late: number;
  /** Notes never matched: expected minus hits minus late. */
  misses: number;
  /** Presses that matched no note. */
  wrong: number;
  /** Presses that matched a note already matched. */
  repeats: number;
  /** Presses left unsure. They count neither for nor against the player. */
  unsure: number;
  accuracy: number;
  /** The exact 32-bit pattern of `accuracy`, for comparing builds bit for bit. */
  accuracyBits: number;
  meanTimingErrorMs: number | null;
  meanTimingErrorBits: number | null;
  finalSpeedPpm: number;
  meanSpeedPpm: number | null;
  /** Which hands were played. "unknown" when the notes carry no hand labels. */
  hands: PlayedHands;
  /** Expected notes in the hands played: all of them unless one hand only was played. */
  playedExpected: number;
  /** Hits in the hands played over `playedExpected` plus wrong presses. */
  playedAccuracy: number;
  playedAccuracyBits: number;
}

export interface FollowResult {
  /** One event for every press, with every change of reading already applied. */
  events: FollowEvent[];
  summary: FollowSummary;
}

/**
 * To follow a session live, keep one event per press: put `event` at its
 * `playedIndex` and replace each event in `revised` at its own. The place may step
 * back only when `revised` is not empty or `event.jumpedFrom` is set. Presses
 * before `settled` are final and are never revised again.
 */
export interface PushResult {
  event: FollowEvent;
  /** Earlier events the follower now reads differently, oldest first. */
  revised: FollowEvent[];
  /** Presses whose events are final: every press with a smaller index. */
  settled: number;
}

/** The first pass: presses compared with the clock as written. */
export interface PassageScore {
  expected: number;
  hits: number;
  misses: number;
  wrong: number;
  accuracy: number;
  accuracyBits: number;
  meanTimingErrorMs: number | null;
  meanTimingErrorBits: number | null;
}

/** Thrown for bad input or when the engine refuses it. The message says what to change. */
export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
  }
}

let ready = false;

/** Loads the module in a browser. Pass the module's URL when your bundler does not find it. */
export async function init(source?: InitInput | Promise<InitInput>): Promise<void> {
  if (ready) return;
  await initWasm(source === undefined ? undefined : { module_or_path: source });
  ready = true;
}

/** Loads the module from bytes already in memory, for Node and tests. */
export function initSync(source: SyncInitInput): void {
  if (ready) return;
  initWasmSync({ module: source });
  ready = true;
}

const EVENT_KINDS: readonly EventKind[] = ["hit", "wrong", "late", "repeat", "unsure"];
const HANDS: readonly PlayedHands[] = ["unknown", "neither", "left", "right", "both"];
const U32_MAX = 4_294_967_295;

function mustBeReady(): void {
  if (!ready) {
    throw new ScoringError("the scoring engine is not loaded: await init() or call initSync() first");
  }
}

function whole(value: unknown, name: string, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) {
    throw new ScoringError(`${name} must be a whole number from ${low} to ${high}, got ${String(value)}`);
  }
  return value;
}

/** Reads a field, turning a getter that throws into a ScoringError that names it. */
function field(item: object, key: string, name: string): unknown {
  try {
    return (item as Record<string, unknown>)[key];
  } catch (error) {
    throw new ScoringError(`${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function split(list: unknown, name: string, limit: number): [Uint32Array, Uint8Array, Uint8Array] {
  if (!Array.isArray(list)) {
    throw new ScoringError(`${name} must be an array of notes, got ${list === null ? "null" : typeof list}`);
  }
  if (list.length > limit) {
    throw new ScoringError(`${name} has ${String(list.length)} notes, the limit is ${String(limit)}`);
  }
  const times = new Uint32Array(list.length);
  const pitches = new Uint8Array(list.length);
  const hands = new Uint8Array(list.length);
  let labelled = false;
  // a plain loop, so a hole in a sparse array is seen and not skipped
  for (let i = 0; i < list.length; i++) {
    const at = `${name}[${String(i)}]`;
    const n: unknown = list[i];
    if (n === null || typeof n !== "object") {
      throw new ScoringError(`${at} must be a note { tMs, note }, got ${n === null ? "null" : typeof n}`);
    }
    times[i] = whole(field(n, "tMs", `${at}.tMs`), `${at}.tMs`, 0, U32_MAX);
    pitches[i] = whole(field(n, "note", `${at}.note`), `${at}.note`, 0, 127);
    const hand = field(n, "hand", `${at}.hand`);
    if (hand === "left" || hand === "right") {
      hands[i] = hand === "left" ? 1 : 2;
      labelled = true;
    } else if (hand !== undefined && hand !== null) {
      throw new ScoringError(`${at}.hand must be "left", "right" or left out, got ${String(hand)}`);
    }
  }
  return [times, pitches, labelled ? hands : new Uint8Array(0)];
}

function settings(config: FollowConfig | undefined): Uint32Array {
  if (config !== undefined && (config === null || typeof config !== "object")) {
    throw new ScoringError("the configuration must be an object");
  }
  const c: Record<string, unknown> = { ...DEFAULT_CONFIG, ...config };
  return Uint32Array.of(
    whole(c.windowMs, "windowMs", 1, 10_000),
    whole(c.band, "band", 4, 256),
    whole(c.pauseMs, "pauseMs", 500, U32_MAX),
    whole(c.chordMs, "chordMs", 0, 1000),
    whole(c.relocateAfter, "relocateAfter", 2, 8),
  );
}

function known(session: Session | undefined): Uint32Array {
  if (session === undefined) return new Uint32Array(0);
  if (session === null || typeof session !== "object") {
    throw new ScoringError("the session must be an object");
  }
  const start = field(session, "startMs", "startMs");
  const practise = field(session, "practise", "practise");
  const hands = practise === undefined || practise === null || practise === "both" ? 0 : practise === "left" ? 1 : practise === "right" ? 2 : -1;
  if (hands < 0) throw new ScoringError(`practise must be "left", "right", "both" or left out, got ${String(practise)}`);
  const told = start !== undefined && start !== null;
  return Uint32Array.of(told ? 1 : 0, told ? whole(start, "startMs", 0, U32_MAX) : 0, hands);
}

function jumpList(session: Session | undefined): Uint32Array {
  const jumps: unknown = session === undefined || session === null ? undefined : field(session, "jumps", "jumps");
  if (jumps === undefined || jumps === null) return new Uint32Array(0);
  if (!Array.isArray(jumps)) throw new ScoringError("jumps must be an array of { beforePress, toMs }");
  const out = new Uint32Array(jumps.length * 2);
  jumps.forEach((jump: unknown, i) => {
    if (jump === null || typeof jump !== "object") throw new ScoringError(`jumps[${i}] must be { beforePress, toMs }`);
    out[2 * i] = whole(field(jump, "beforePress", `jumps[${i}].beforePress`), `jumps[${i}].beforePress`, 0, U32_MAX);
    out[2 * i + 1] = whole(field(jump, "toMs", `jumps[${i}].toMs`), `jumps[${i}].toMs`, 0, U32_MAX);
  });
  return out;
}

function float(bits: number): number {
  return new Float32Array(Uint32Array.of(bits).buffer)[0] ?? Number.NaN;
}

function events(flat: Int32Array): FollowEvent[] {
  const out: FollowEvent[] = [];
  for (let i = 0; i + 6 < flat.length; i += 7) {
    const at = (k: number): number => flat[i + k] ?? 0;
    out.push({
      playedIndex: at(0),
      kind: EVENT_KINDS[at(1)] ?? "wrong",
      expectedIndex: at(2) < 0 ? null : at(2),
      position: at(3),
      errorMs: at(4),
      speedPpm: at(5),
      jumpedFrom: at(6) < 0 ? null : at(6),
    });
  }
  return out;
}

function summary(flat: Uint32Array): FollowSummary {
  const at = (k: number): number => flat[k] ?? 0;
  return {
    expected: at(0),
    hits: at(1),
    late: at(2),
    misses: at(3),
    wrong: at(4),
    repeats: at(5),
    accuracy: float(at(6)),
    accuracyBits: at(6),
    meanTimingErrorMs: at(7) === 1 ? float(at(8)) : null,
    meanTimingErrorBits: at(7) === 1 ? at(8) : null,
    finalSpeedPpm: at(9),
    meanSpeedPpm: at(10) === 1 ? at(11) : null,
    hands: HANDS[at(12)] ?? "unknown",
    playedExpected: at(13),
    playedAccuracy: float(at(14)),
    playedAccuracyBits: at(14),
    unsure: at(15),
  };
}

function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ScoringError) throw error;
    throw new ScoringError(error instanceof Error ? error.message : String(error));
  }
}

/** Scores a passage against the clock as written, with a fixed timing window. */
export function scorePassage(expected: readonly Note[], played: readonly Note[], windowMs = 150): PassageScore {
  mustBeReady();
  return guarded(() => {
    const [et, en] = split(expected, "expected", MAX_EXPECTED);
    const [pt, pn] = split(played, "played", MAX_PLAYED);
    const out = score_passage(et, en, pt, pn, whole(windowMs, "windowMs", 0, U32_MAX));
    const at = (k: number): number => out[k] ?? 0;
    return {
      expected: at(0),
      hits: at(1),
      misses: at(2),
      wrong: at(3),
      accuracy: float(at(4)),
      accuracyBits: at(4),
      meanTimingErrorMs: at(5) === 1 ? float(at(6)) : null,
      meanTimingErrorBits: at(5) === 1 ? at(6) : null,
    };
  });
}

/** Follows a whole recorded performance and returns the final alignment of every press. */
export function follow(expected: readonly Note[], played: readonly Note[], config?: FollowConfig, session?: Session): FollowResult {
  mustBeReady();
  return guarded(() => {
    const [et, en, eh] = split(expected, "expected", MAX_EXPECTED);
    const [pt, pn] = split(played, "played", MAX_PLAYED);
    const result = follow_performance(et, en, eh, pt, pn, settings(config), known(session), jumpList(session));
    try {
      return { events: events(result.events), summary: summary(result.summary) };
    } finally {
      result.free();
    }
  });
}

/**
 * Follows a live performance one press at a time. Call `free()` when the session
 * ends (or declare it with `using`) so the module's memory is returned. Calling
 * `free()` twice does nothing. Using a session after `free()` throws a ScoringError.
 */
export class Follower {
  #inner: WasmFollower | null;

  constructor(expected: readonly Note[], config?: FollowConfig, session?: Session) {
    mustBeReady();
    this.#inner = guarded(() => {
      const [times, pitches, hands] = split(expected, "expected", MAX_EXPECTED);
      return new WasmFollower(times, pitches, hands, settings(config), known(session));
    });
  }

  /**
   * Tells the engine the learner goes on from the written time `toMs`: they pressed Repeat or Next phrase or chose
   * another bar. The next press is read from there. Notes played before and played again come back as "repeat".
   */
  jumpTo(toMs: number): void {
    const inner = this.#live();
    guarded(() => inner.jumpTo(whole(toMs, "toMs", 0, U32_MAX)));
  }

  #live(): WasmFollower {
    if (this.#inner === null) throw new ScoringError("this session has been freed: start a new Follower");
    return this.#inner;
  }

  /** Takes the next press. Presses must arrive in time order. */
  push(press: Note): PushResult {
    const inner = this.#live();
    return guarded(() => {
      if (press === null || typeof press !== "object") {
        throw new ScoringError(`a press must be a note { tMs, note }, got ${press === null ? "null" : typeof press}`);
      }
      const tMs = whole(field(press, "tMs", "tMs"), "tMs", 0, U32_MAX);
      const note = whole(field(press, "note", "note"), "note", 0, 127);
      const flat = inner.push(tMs, note);
      const settled = flat[flat.length - 1] ?? 0;
      const all = events(flat.subarray(0, flat.length - 1));
      const event = all.pop();
      if (event === undefined) throw new ScoringError("the engine returned no event");
      return { event, revised: all, settled };
    });
  }

  /** The summary of everything pushed so far. */
  finish(): FollowSummary {
    const inner = this.#live();
    return guarded(() => summary(inner.finish()));
  }

  /** The tempo reached: 1 000 000 is the written speed. */
  get speedPpm(): number {
    const inner = this.#live();
    return guarded(() => inner.speedPpm);
  }

  /** The chord group the player has reached. */
  get position(): number {
    const inner = this.#live();
    return guarded(() => inner.position);
  }

  free(): void {
    const inner = this.#inner;
    this.#inner = null;
    inner?.free();
  }

  [Symbol.dispose](): void {
    this.free();
  }
}
