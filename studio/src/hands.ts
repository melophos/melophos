// the split of an imported piece into a left and a right hand. it is a first guess and is always presented as one:
// the player can correct it note by note or with a split point, every correction is kept with the piece and undone one
// step at a time and "back to the first guess" removes them all. the guess follows the server's rules
// (server/app/hands.py), so the two give the same answer for the same file.
import type { MidiNote, MidiSong } from "./midi-file";
import type { Hand } from "./songs";

export type Method = "track_name" | "track_pitch" | "channel_pitch" | "pitch";

export interface HandSplit {
  method: Method;
  // one entry per note, in the order of song.notes
  hands: Hand[];
}

export const EXPLANATIONS: Record<Method, string> = {
  track_name: "Two tracks are named for a hand, so the names decide.",
  track_pitch: "The file has separate tracks. The track with the lower notes is the left hand.",
  channel_pitch: "The file uses separate MIDI channels. The channel with the lower notes is the left hand.",
  pitch: "The file has one stream of notes, so each note goes to the nearer of two hand positions that follow the music.",
};

const RIGHT_HINT = /\b(right|rh|r\.h\.?|treble|upper)\b/i;
const LEFT_HINT = /\b(left|lh|l\.h\.?|bass|lower)\b/i;
const MIN_SEPARATION = 7;
const FOLLOW = 0.1;
const MIN_CENTRE_GAP = 12;
const ONE_HAND_SPAN = 14;
const MIDDLE_C = 60;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function group(notes: readonly MidiNote[], key: (n: MidiNote) => number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  // pushed in place: copying the list for every note made a long single track take seconds
  for (const n of notes) {
    const k = key(n);
    const list = out.get(k);
    if (list) list.push(n.note);
    else out.set(k, [n.note]);
  }
  return out;
}

function byName(groups: Map<number, number[]>, names: Map<number, string>): Map<number, Hand> | null {
  const keys = [...groups.keys()];
  const right = keys.filter((t) => RIGHT_HINT.test(names.get(t) ?? "") && !LEFT_HINT.test(names.get(t) ?? ""));
  const left = keys.filter((t) => LEFT_HINT.test(names.get(t) ?? "") && !RIGHT_HINT.test(names.get(t) ?? ""));
  const r0 = right[0];
  const l0 = left[0];
  if (right.length !== 1 || left.length !== 1 || r0 === undefined || l0 === undefined) return null;
  const result = new Map<number, Hand>([
    [r0, "right"],
    [l0, "left"],
  ]);
  for (const [t, pitches] of groups) {
    if (result.has(t)) continue;
    const m = median(pitches);
    result.set(t, Math.abs(m - median(groups.get(r0) ?? [])) <= Math.abs(m - median(groups.get(l0) ?? [])) ? "right" : "left");
  }
  return result;
}

function byMedian(groups: Map<number, number[]>): Map<number, Hand> | null {
  const medians = new Map([...groups].map(([k, v]) => [k, median(v)] as const));
  const values = [...medians.values()];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high - low < MIN_SEPARATION) return null;
  const middle = (low + high) / 2;
  return new Map([...medians].map(([k, m]) => [k, m < middle ? "left" : "right"] as const));
}

function quartile(sorted: number[], q: number): number {
  const index = q * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.min(low + 1, sorted.length - 1);
  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (index - low);
}

function followPitch(notes: readonly MidiNote[]): Hand[] {
  const pitches = notes.map((n) => n.note).sort((a, b) => a - b);
  const first = pitches[0] ?? 0;
  const last = pitches[pitches.length - 1] ?? 0;
  if (last - first <= ONE_HAND_SPAN) return notes.map(() => (median(pitches) >= MIDDLE_C ? "right" : "left"));
  let left = quartile(pitches, 0.25);
  let right = quartile(pitches, 0.75);
  if (right - left < MIN_CENTRE_GAP) {
    const mid = (left + right) / 2;
    left = mid - MIN_CENTRE_GAP / 2;
    right = mid + MIN_CENTRE_GAP / 2;
  }
  const order = notes.map((_, i) => i).sort((a, b) => (notes[a]?.tMs ?? 0) - (notes[b]?.tMs ?? 0) || (notes[a]?.note ?? 0) - (notes[b]?.note ?? 0) || a - b);
  const out: Hand[] = notes.map(() => "right");
  for (const i of order) {
    const pitch = notes[i]?.note ?? 0;
    if (Math.abs(pitch - left) < Math.abs(pitch - right)) {
      out[i] = "left";
      left += (pitch - left) * FOLLOW;
    } else {
      out[i] = "right";
      right += (pitch - right) * FOLLOW;
    }
    if (right - left < MIN_CENTRE_GAP) {
      const squeeze = (MIN_CENTRE_GAP - (right - left)) / 2;
      left -= squeeze;
      right += squeeze;
    }
  }
  return out;
}

export function splitHands(song: Pick<MidiSong, "notes" | "tracks">): HandSplit {
  const { notes } = song;
  const names = new Map(song.tracks.map((t) => [t.index, t.name] as const));
  const tracks = group(notes, (n) => n.track);
  if (tracks.size >= 2) {
    const named = byName(tracks, names);
    if (named) return { method: "track_name", hands: notes.map((n) => named.get(n.track) ?? "right") };
    const grouped = byMedian(tracks);
    if (grouped) return { method: "track_pitch", hands: notes.map((n) => grouped.get(n.track) ?? "right") };
  }
  const channels = group(notes, (n) => n.channel);
  if (channels.size >= 2) {
    const grouped = byMedian(channels);
    if (grouped) return { method: "channel_pitch", hands: notes.map((n) => grouped.get(n.channel) ?? "right") };
  }
  return { method: "pitch", hands: followPitch(notes) };
}

// ---- corrections: kept with the piece, as a map from a note's idx to the hand the player chose

export type Corrections = Record<string, Hand>;

export function effectiveHands(guess: readonly Hand[], corrections: Corrections): Hand[] {
  return guess.map((h, i) => corrections[String(i)] ?? h);
}

export const correctedCount = (guess: readonly Hand[], corrections: Corrections): number => guess.filter((h, i) => (corrections[String(i)] ?? h) !== h).length;

// a change is stored only where it differs from the guess, so putting a note back leaves no trace
export function withChange(guess: readonly Hand[], corrections: Corrections, changes: { idx: number; hand: Hand }[]): Corrections {
  const next: Corrections = { ...corrections };
  for (const c of changes) {
    if (c.idx < 0 || c.idx >= guess.length) continue;
    if (guess[c.idx] === c.hand) delete next[String(c.idx)];
    else next[String(c.idx)] = c.hand;
  }
  return next;
}

// every note from one pitch down goes to the left hand and the rest to the right, inside a range of notes
export function splitPointChanges(notes: readonly { note: number }[], point: number, from = 0, to = notes.length - 1): { idx: number; hand: Hand }[] {
  const out: { idx: number; hand: Hand }[] = [];
  for (let i = Math.max(0, from); i <= Math.min(notes.length - 1, to); i++) out.push({ idx: i, hand: (notes[i]?.note ?? 0) < point ? "left" : "right" });
  return out;
}

// one step back at a time
export class History {
  private readonly past: Corrections[] = [];

  constructor(private current: Corrections) {}

  get value(): Corrections {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  apply(next: Corrections): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    if (this.past.length > 200) this.past.shift();
    this.current = next;
  }

  undo(): Corrections {
    const before = this.past.pop();
    if (before) this.current = before;
    return this.current;
  }

  reset(): Corrections {
    this.apply({});
    return this.current;
  }
}
