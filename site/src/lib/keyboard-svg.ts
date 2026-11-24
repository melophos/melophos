// the keyboard figure: 88 keys drawn as SVG with the rail of lights above them, as the real bar sits.
// the markup is made at build time, so the figure is a still drawing when scripts are off.
// geometry follows the Studio's keyboard: a white key owns one slot and a black key sits on the line between two.

import { isBlackKey, noteName } from "../../../studio/src/notes.ts";

export const LOWEST = 21; // A0
export const HIGHEST = 108; // C8
export const KEY_W = 24;
export const KEY_H = 150;
export const BLACK_W = 14;
export const BLACK_H = 92;
export const RAIL_H = 44;
export const GAP = 12;
export const TOP = RAIL_H + GAP;
export const LABEL_H = 30;

export interface KeyGeometry {
  note: number;
  black: boolean;
  x: number; // left edge
  centre: number; // x of the light above the key
  name: string;
}

export function keyGeometry(): KeyGeometry[] {
  const keys: KeyGeometry[] = [];
  let white = 0;
  for (let note = LOWEST; note <= HIGHEST; note++) {
    const black = isBlackKey(note);
    if (black) {
      keys.push({ note, black, x: white * KEY_W - BLACK_W / 2, centre: white * KEY_W, name: noteName(note) });
    } else {
      keys.push({ note, black, x: white * KEY_W, centre: white * KEY_W + KEY_W / 2, name: noteName(note) });
      white += 1;
    }
  }
  return keys;
}

export const WHITE_COUNT = keyGeometry().filter((k) => !k.black).length;
export const WIDTH = WHITE_COUNT * KEY_W;
export const HEIGHT = TOP + KEY_H + LABEL_H;

// a short exercise, written for this figure. one arpeggio up and one down, with no repeated key in a row,
// so every step moves the light
export const EXERCISE: number[] = [60, 64, 67, 64, 62, 65, 69, 65, 64, 67, 72, 67, 64, 62];

// notes read out in words for the text alternative: "E4", "F sharp 4"
export function spokenName(note: number): string {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(noteName(note));
  return m ? `${m[1]}${m[2] ? " sharp" : ""} ${m[3]}` : noteName(note);
}

const first = EXERCISE[0] ?? 60;

export function describeLit(note: number): string {
  return `The rail above the keys has one large light on. It is above ${spokenName(note)}. The key below it is filled and outlined. The two lights after it are small rings.`;
}

export const initialDescription = (): string => describeLit(first);

export function keyboardMarkup(): string {
  const keys = keyGeometry();
  const byNote = new Map(keys.map((k) => [k.note, k]));
  const whites = keys.filter((k) => !k.black);
  const blacks = keys.filter((k) => k.black);
  const lit = (note: number): string => (note === first ? " is-lit" : "");
  const rail = keys
    .map((k) => `<circle class="led" data-note="${k.note}" cx="${k.centre}" cy="${RAIL_H / 2}" r="3"/>`)
    .join("");
  const whiteKeys = whites
    .map((k) => `<rect class="key key-white${lit(k.note)}" data-note="${k.note}" x="${k.x + 0.5}" y="${TOP}" width="${KEY_W - 1}" height="${KEY_H}" rx="3"/>`)
    .join("");
  const blackKeys = blacks
    .map((k) => `<rect class="key key-black${lit(k.note)}" data-note="${k.note}" x="${k.x}" y="${TOP}" width="${BLACK_W}" height="${BLACK_H}" rx="2"/>`)
    .join("");
  const cLabels = whites
    .filter((k) => k.note % 12 === 0)
    .map((k) => `<text class="c-label" x="${k.centre}" y="${TOP + KEY_H - 8}" text-anchor="middle">${k.name}</text>`)
    .join("");
  const cx = (note: number | undefined): number => byNote.get(note ?? first)?.centre ?? 0;
  const ring = (note: number | undefined): string => `<circle class="soon" cx="${cx(note)}" cy="${RAIL_H / 2}" r="9"/>`;
  return [
    `<rect class="rail" x="0" y="0" width="${WIDTH}" height="${RAIL_H}" rx="6"/>`,
    `<g class="leds">${rail}</g>`,
    `<g class="keys">${whiteKeys}${blackKeys}</g>`,
    `<g class="c-labels">${cLabels}</g>`,
    // the lit light and its marker. the script moves them. at rest they sit on the first note
    `<g class="lit">${ring(EXERCISE[1])}${ring(EXERCISE[2])}<circle class="next" cx="${cx(first)}" cy="${RAIL_H / 2}" r="13"/><circle class="key-marker" cx="${cx(first)}" cy="${TOP + KEY_H - 40}" r="5"/></g>`,
    `<text class="lit-label" x="${cx(first)}" y="${TOP + KEY_H + 22}" text-anchor="middle">${byNote.get(first)?.name ?? ""}</text>`,
  ].join("");
}
