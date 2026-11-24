// follows one practice run through a song: which note is expected next, whether each played note
// was right and how far from the beat it landed. Pure logic, so the keyboard, the demo player and
// a real MIDI device all drive the same stepping.
//
// the engine decides only which note is next. every figure a player is shown (accuracy, hits, timing) comes from
// the scoring engine in core/, which the app feeds with the same presses. the counts kept here are counts of steps.
import { beatMs, excerpt, groupsOf, type Excerpt, type TimedNote } from "./piece";
import type { Song } from "./songs";

export interface Result {
  expected: number;
  played: number;
  correct: boolean;
  // positive means late, in milliseconds
  offsetMs: number;
  // the group the press belonged to
  group: number;
  // set on a correct press made with no wrong press before it in its group
  firstTime: boolean;
}

export interface Summary {
  notes: number;
  correct: number;
  accuracy: number;
  meanOffsetMs: number;
  bestStreak: number;
  // notes of the piece in this run and how many were right first time
  total: number;
  firstTime: number;
}

export class Practice {
  readonly results: Result[] = [];
  readonly groups: TimedNote[][];
  private index = 0;
  // where this stretch began: the first group or the one a jump landed on. groups a jump skipped were never reached
  private startGroup = 0;
  private startedAt: number | null = null;
  private remaining: Set<number>;
  private groupWrong = false;
  private firstTimeCount = 0;
  // wrong presses counted against the note that was expected, which is where a player needs more practice
  private readonly missed = new Map<number, number>();

  constructor(
    readonly song: Song,
    readonly choice: Excerpt = { hand: "both" },
  ) {
    this.groups = groupsOf(excerpt(song, choice));
    this.remaining = this.freshGroup();
  }

  get position(): number {
    return this.index;
  }

  get finished(): boolean {
    return this.index >= this.groups.length;
  }

  get total(): number {
    return this.groups.reduce((n, g) => n + g.length, 0);
  }

  // the notes the player has got to: every note of the groups left behind and the ones pressed in the group in hand
  reachedNotes(): TimedNote[] {
    const out: TimedNote[] = [];
    for (let g = this.startGroup; g < this.index; g++) out.push(...(this.groups[g] ?? []));
    for (const n of this.groups[this.index] ?? []) if (!this.remaining.has(n.note)) out.push(n);
    return out;
  }

  // wrong presses in this run
  get wrongCount(): number {
    return this.results.filter((r) => !r.correct).length;
  }

  get missedNotes(): ReadonlyMap<number, number> {
    return this.missed;
  }

  private freshGroup(): Set<number> {
    return new Set((this.groups[this.index] ?? []).map((n) => n.note));
  }

  // the notes still to press in the current group, lowest first
  get due(): number[] {
    return [...this.remaining].sort((a, b) => a - b);
  }

  // the next few expected notes, nearest first, for the guide lights. a chord counts as all its notes
  upcoming(count: number): number[] {
    return this.upcomingDetail(count).map((n) => n.note);
  }

  // the same notes with their hand and finger
  upcomingDetail(count: number): TimedNote[] {
    const out: TimedNote[] = [];
    for (let g = this.index; g < this.groups.length && out.length < count; g++) {
      for (const n of this.groups[g] ?? []) {
        if (g === this.index && !this.remaining.has(n.note)) continue;
        out.push(n);
      }
    }
    return out;
  }

  // moves to the first group at or after a beat, for repeating a phrase or going on to the next
  seekToBeat(beat: number): void {
    const found = this.groups.findIndex((g) => (g[0]?.startBeat ?? 0) >= beat - 0.001);
    this.index = found < 0 ? this.groups.length : found;
    this.startGroup = this.index;
    this.remaining = this.freshGroup();
    this.groupWrong = false;
    this.startedAt = null;
  }

  // when the expected group should land, measured from the first note played
  expectedTimeMs(index: number): number {
    const first = this.groups[0]?.[0]?.startBeat ?? 0;
    const at = this.groups[index]?.[0]?.startBeat ?? first;
    return (at - first) * beatMs(this.song.tempo);
  }

  play(note: number, atMs: number): Result | null {
    if (this.finished) return null;
    if (this.startedAt === null) this.startedAt = atMs;
    const expectedNow = this.due[0] ?? 0;
    const correct = this.remaining.has(note);
    const offsetMs = Math.round(atMs - this.startedAt - this.expectedTimeMs(this.index));
    let firstTime = false;
    if (correct) {
      firstTime = !this.groupWrong;
      if (firstTime) this.firstTimeCount += 1;
      this.remaining.delete(note);
      if (this.remaining.size === 0) {
        this.index += 1;
        this.groupWrong = false;
        this.remaining = this.freshGroup();
      }
    } else {
      this.groupWrong = true;
      this.missed.set(expectedNow, (this.missed.get(expectedNow) ?? 0) + 1);
    }
    // a wrong note is marked and the guide waits on the same note, as a teacher would
    const result: Result = { expected: correct ? note : expectedNow, played: note, correct, offsetMs, group: correct && this.remaining.size === 0 ? this.index - 1 : this.index, firstTime };
    this.results.push(result);
    return result;
  }

  summary(): Summary {
    const correct = this.results.filter((r) => r.correct);
    let streak = 0;
    let bestStreak = 0;
    for (const r of this.results) {
      streak = r.correct ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
    }
    return {
      notes: this.results.length,
      correct: correct.length,
      accuracy: this.results.length ? correct.length / this.results.length : 0,
      meanOffsetMs: correct.length ? Math.round(correct.reduce((t, r) => t + Math.abs(r.offsetMs), 0) / correct.length) : 0,
      bestStreak,
      total: this.total,
      firstTime: this.firstTimeCount,
    };
  }
}
