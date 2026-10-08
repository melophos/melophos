// follows one practice run through a song: which note is expected next, whether each played note
// was right and how far from the beat it landed. Pure logic, so the keyboard, the demo player and
// a real MIDI device all drive the same scoring.
import type { Song } from "./songs";

export interface Result {
  expected: number;
  played: number;
  correct: boolean;
  // positive means late, in milliseconds
  offsetMs: number;
}

export interface Summary {
  notes: number;
  correct: number;
  accuracy: number;
  meanOffsetMs: number;
  bestStreak: number;
}

export class Practice {
  readonly results: Result[] = [];
  private index = 0;
  private startedAt: number | null = null;

  constructor(readonly song: Song) {}

  get position(): number {
    return this.index;
  }

  get finished(): boolean {
    return this.index >= this.song.notes.length;
  }

  // the next few expected notes, nearest first, for the guide lights
  upcoming(count: number): number[] {
    return this.song.notes.slice(this.index, this.index + count).map((n) => n.note);
  }

  // when the expected note should land, measured from the first note played
  expectedTimeMs(index: number): number {
    const beatMs = 60_000 / this.song.tempo;
    return this.song.notes.slice(0, index).reduce((t, n) => t + n.beats * beatMs, 0);
  }

  play(note: number, atMs: number): Result | null {
    if (this.finished) return null;
    if (this.startedAt === null) this.startedAt = atMs;
    const expected = this.song.notes[this.index]!.note;
    const result = { expected, played: note, correct: note === expected, offsetMs: Math.round(atMs - this.startedAt - this.expectedTimeMs(this.index)) };
    this.results.push(result);
    // a wrong note is marked and the guide waits on the same note, as a teacher would
    if (result.correct) this.index += 1;
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
    };
  }
}
