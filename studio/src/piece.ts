// a song laid out in time: every note with its start in beats, its hand and its finger. the lane, the lights, the
// audio scheduler and the stepper all read this one layout, so they cannot disagree about when a note is due.
import type { Hand, Song } from "./songs";

export interface TimedNote {
  // position in the laid out piece, stable for a given song and filter
  index: number;
  note: number;
  hand: Hand;
  finger?: number | undefined;
  startBeat: number;
  beats: number;
}

export type HandChoice = "both" | "left" | "right";

export interface Excerpt {
  hand: HandChoice;
  // bars are counted from 1 and both ends are included. left out, the whole piece
  fromBar?: number | undefined;
  toBar?: number | undefined;
}

const EPSILON = 0.001;

export const beatsPerBar = (song: Song): number => song.beatsPerBar ?? 4;

export function totalBeats(song: Song): number {
  return layout(song).reduce((end, n) => Math.max(end, n.startBeat + n.beats), 0);
}

export function barCount(song: Song): number {
  return Math.max(1, Math.ceil(totalBeats(song) / beatsPerBar(song) - EPSILON));
}

// every note of the song with its start, in the order it is due. chords keep the lower pitch first
export function layout(song: Song): TimedNote[] {
  let cursor = 0;
  const placed = song.notes.map((n) => {
    const startBeat = n.at ?? cursor;
    cursor = startBeat + n.beats;
    return { note: n.note, hand: n.hand ?? "right", finger: n.finger, startBeat, beats: n.beats };
  });
  placed.sort((a, b) => a.startBeat - b.startBeat || a.note - b.note);
  return placed.map((n, index) => ({ ...n, index }));
}

// the notes the player has chosen to practise: one hand or both and a range of bars. start beats stay as written
export function excerpt(song: Song, choice: Excerpt): TimedNote[] {
  const perBar = beatsPerBar(song);
  const from = choice.fromBar === undefined ? 0 : (Math.max(1, choice.fromBar) - 1) * perBar;
  const to = choice.toBar === undefined ? Infinity : Math.max(1, choice.toBar) * perBar;
  return layout(song)
    .filter((n) => (choice.hand === "both" || n.hand === choice.hand) && n.startBeat >= from - EPSILON && n.startBeat < to - EPSILON)
    .map((n, index) => ({ ...n, index }));
}

// notes due together form one group: a chord or the two hands landing on the same beat
export function groupsOf(notes: readonly TimedNote[]): TimedNote[][] {
  const out: TimedNote[][] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && Math.abs((last[0]?.startBeat ?? 0) - n.startBeat) < EPSILON) last.push(n);
    else out.push([n]);
  }
  return out;
}

// 1 based bar number that a beat falls in
export const barOf = (song: Song, beat: number): number => Math.floor(beat / beatsPerBar(song) + EPSILON) + 1;

// the lowest and highest key a set of notes uses
export function rangeOf(notes: readonly { note: number }[]): { lowest: number; highest: number } | null {
  if (notes.length === 0) return null;
  let lowest = 127;
  let highest = 0;
  for (const n of notes) {
    lowest = Math.min(lowest, n.note);
    highest = Math.max(highest, n.note);
  }
  return { lowest, highest };
}

export const beatMs = (tempo: number, speed = 1): number => 60_000 / (tempo * speed);
