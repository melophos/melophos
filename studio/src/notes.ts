const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(note: number): boolean {
  return BLACK.has(note % 12);
}

// Scientific pitch notation, where MIDI 60 is C4.
export function noteName(note: number): string {
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function keyRange(lowest: number, highest: number): number[] {
  return Array.from({ length: highest - lowest + 1 }, (_, i) => lowest + i);
}
