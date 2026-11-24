// where each key sits, in white key widths from the left edge of the lowest key. one function feeds the on-screen
// keyboard, the lane and the firmware parity test, so a falling note always lands on the key it names.
// the formulas are the firmware's own (firmware/lib/keymap/keymap.cpp): a black key is centred on the line between its
// two white neighbours.
import { isBlackKey } from "./notes";

const WHITE_BEFORE = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6] as const;

export const BLACK_WIDTH = 0.6;

// white keys below a pitch, counted from C0 of the MIDI scale
export const whiteKeysBelow = (note: number): number => Math.floor(note / 12) * 7 + (WHITE_BEFORE[note % 12] ?? 0);

// the left edge of the lowest key. a black lowest key sits half a white key back
export const leftEdge = (lowest: number): number => whiteKeysBelow(lowest) - (isBlackKey(lowest) ? 0.5 : 0);

export interface KeyBox {
  note: number;
  black: boolean;
  // in white key widths from the left edge of the range
  x: number;
  width: number;
  // the centre of the key, which is where its light and its falling note are drawn
  centre: number;
}

export function keyBox(note: number, lowest: number): KeyBox {
  const black = isBlackKey(note);
  const edge = leftEdge(lowest);
  if (black) {
    const centre = whiteKeysBelow(note) - edge;
    return { note, black, x: centre - BLACK_WIDTH / 2, width: BLACK_WIDTH, centre };
  }
  const x = whiteKeysBelow(note) - edge;
  return { note, black, x, width: 1, centre: x + 0.5 };
}

export function whiteKeyCount(lowest: number, highest: number): number {
  let count = 0;
  for (let n = lowest; n <= highest; n++) if (!isBlackKey(n)) count += 1;
  return count;
}

// the width of the range in white key widths. a black key at the very end hangs half a white key over the edge
export function rangeWidth(lowest: number, highest: number): number {
  const last = keyBox(highest, lowest);
  return Math.max(whiteKeyCount(lowest, highest), last.x + last.width);
}

// the profile's own measures: the centre of a key in millimetres, as the firmware computes it
export interface KeyboardGeometry {
  lowest: number;
  highest: number;
  whiteKeyMm: number;
  layout: "per-key" | "strip";
  densityPerM?: number;
  offset: number;
  reversed: boolean;
}

export const keyCentreMm = (g: KeyboardGeometry, note: number): number => keyBox(note, g.lowest).centre * g.whiteKeyMm;

export function ledCount(g: KeyboardGeometry): number {
  if (g.layout === "per-key") return g.highest - g.lowest + 1 + g.offset;
  const widthMm = rangeWidth(g.lowest, g.highest) * g.whiteKeyMm;
  const pitchMm = 1000 / (g.densityPerM ?? 144);
  return Math.ceil(widthMm / pitchMm) + g.offset;
}

export function ledIndexForNote(g: KeyboardGeometry, note: number): number {
  if (note < g.lowest || note > g.highest) return -1;
  let index: number;
  if (g.layout === "per-key") {
    index = note - g.lowest + g.offset;
  } else {
    const pitchMm = 1000 / (g.densityPerM ?? 144);
    index = Math.floor(keyCentreMm(g, note) / pitchMm) + g.offset;
  }
  if (g.reversed) index = ledCount(g) - 1 - (index - g.offset) + g.offset;
  return index;
}
