import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BLACK_WIDTH, keyBox, keyCentreMm, ledCount, ledIndexForNote, rangeWidth, whiteKeyCount, type KeyboardGeometry } from "./geometry";

const piano88: KeyboardGeometry = { lowest: 21, highest: 108, whiteKeyMm: 23.5, layout: "per-key", offset: 0, reversed: false };
const strip144: KeyboardGeometry = { ...piano88, layout: "strip", densityPerM: 144 };

// the same cases as firmware/test/test_keymap/test_main.cpp
describe("keyboard geometry against the firmware cases", () => {
  it("maps every key once on a per-key bar", () => {
    expect(ledCount(piano88)).toBe(88);
    expect(ledIndexForNote(piano88, 21)).toBe(0);
    expect(ledIndexForNote(piano88, 60)).toBe(39);
    expect(ledIndexForNote(piano88, 108)).toBe(87);
  });

  it("rejects notes outside the range", () => {
    expect(ledIndexForNote(piano88, 20)).toBe(-1);
    expect(ledIndexForNote(piano88, 109)).toBe(-1);
  });

  it("spans the keybed on a 144 LED a metre strip", () => {
    expect(ledCount(strip144)).toBe(176);
    expect(ledIndexForNote(strip144, 21)).toBe(1);
    expect(ledIndexForNote(strip144, 108)).toBe(174);
  });

  it("raises the index with pitch on a strip", () => {
    let previous = -1;
    for (let n = 21; n <= 108; n++) {
      const i = ledIndexForNote(strip144, n);
      expect(i).toBeGreaterThanOrEqual(previous);
      previous = i;
    }
  });
});

describe("key positions", () => {
  it("has 52 white keys on an 88 key piano", () => {
    expect(whiteKeyCount(21, 108)).toBe(52);
    expect(rangeWidth(21, 108)).toBe(52);
  });

  it("centres a black key on the line between its white neighbours", () => {
    const c = keyBox(60, 21);
    const d = keyBox(62, 21);
    const cSharp = keyBox(61, 21);
    expect(cSharp.centre).toBeCloseTo((c.x + 1 + d.x) / 2, 9);
    expect(cSharp.width).toBe(BLACK_WIDTH);
  });

  it("matches the firmware's centres in millimetres for every profile in the repository", () => {
    const dir = new URL("../../profiles/", import.meta.url).pathname;
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "schema.json")) {
      const p = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        type: string;
        notes?: { lowest: number; highest: number };
        geometry?: { white_key_mm: number };
      };
      if (p.type !== "keyboard" || !p.notes || !p.geometry) continue;
      const g: KeyboardGeometry = { lowest: p.notes.lowest, highest: p.notes.highest, whiteKeyMm: p.geometry.white_key_mm, layout: "per-key", offset: 0, reversed: false };
      // the firmware formula written out again: white keys below the note, plus half for a white key, less the lowest edge
      const WHITE_BEFORE = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
      const below = (n: number): number => Math.floor(n / 12) * 7 + (WHITE_BEFORE[n % 12] ?? 0);
      const black = (n: number): boolean => [1, 3, 6, 8, 10].includes(n % 12);
      const edge = below(g.lowest) - (black(g.lowest) ? 0.5 : 0);
      for (let n = g.lowest; n <= g.highest; n++) {
        const expected = (below(n) + (black(n) ? 0 : 0.5) - edge) * g.whiteKeyMm;
        expect(Math.abs(keyCentreMm(g, n) - expected), `${file} note ${n}`).toBeLessThan(0.01);
      }
    }
  });
});
