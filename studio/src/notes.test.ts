import { describe, expect, it } from "vitest";

import { parseNoteMessage } from "./midi";
import { isBlackKey, keyRange, noteName } from "./notes";

describe("notes", () => {
  it("names middle C", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(21)).toBe("A0");
  });

  it("knows black keys", () => {
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(64)).toBe(false);
  });

  it("covers an 88-key range", () => {
    expect(keyRange(21, 108)).toHaveLength(88);
  });
});

describe("midi", () => {
  it("reads note on and note off", () => {
    expect(parseNoteMessage(new Uint8Array([0x90, 60, 100]))).toEqual({ note: 60, velocity: 100, channel: 0 });
    expect(parseNoteMessage(new Uint8Array([0x81, 60, 64]))).toEqual({ note: 60, velocity: 0, channel: 1 });
  });

  it("ignores other messages", () => {
    expect(parseNoteMessage(new Uint8Array([0xb0, 64, 127]))).toBeNull();
    expect(parseNoteMessage(new Uint8Array([0x90, 60]))).toBeNull();
  });
});

import { DEFAULT_NAME_OPTIONS, noteLabel, spokenName, type Naming, type OctaveConvention } from "./notes";

describe("naming", () => {
  const english = DEFAULT_NAME_OPTIONS;

  it("names every key from 21 to 108 in each naming and each octave convention", () => {
    const namings: Naming[] = ["english", "german", "solfege"];
    const octaves: OctaveConvention[] = ["c4", "c3"];
    for (const naming of namings) {
      for (const octave of octaves) {
        for (let n = 21; n <= 108; n++) {
          const label = noteLabel(n, { naming, octave, accidental: "sharp" });
          expect(label).toMatch(/^[A-Za-z♯♭]+-?\d$/);
          const spoken = spokenName(n, { naming, octave, accidental: "flat" });
          expect(spoken, `${naming} ${n}`).not.toMatch(/[♯♭#]/);
        }
      }
    }
  });

  it("puts middle C on C4 or C3 as asked", () => {
    expect(noteLabel(60, english)).toBe("C4");
    expect(noteLabel(60, { ...english, octave: "c3" })).toBe("C3");
    expect(noteLabel(21, { ...english, octave: "c3" })).toBe("A-1");
  });

  it("uses the real sharp and flat signs", () => {
    expect(noteLabel(61, english)).toBe("C♯4");
    expect(noteLabel(61, { ...english, accidental: "flat" })).toBe("D♭4");
  });

  it("spells the black keys by the key of the piece", () => {
    // the black key above A is B flat in F major and A sharp in B major
    expect(noteLabel(70, { ...english, key: 5 })).toBe("B♭4");
    expect(noteLabel(70, { ...english, key: 11 })).toBe("A♯4");
    expect(noteLabel(70, { ...english, key: 0, accidental: "flat" })).toBe("B♭4");
  });

  it("says sharp and flat in words for a screen reader", () => {
    expect(spokenName(61, english)).toBe("C sharp 4");
    expect(spokenName(61, { ...english, accidental: "flat" })).toBe("D flat 4");
    expect(spokenName(60, { ...english, naming: "solfege" })).toBe("Do 4");
  });

  it("names the German B and H", () => {
    expect(noteLabel(71, { ...english, naming: "german" })).toBe("H4");
    expect(noteLabel(70, { ...english, naming: "german", accidental: "flat" })).toBe("B4");
    expect(noteLabel(61, { ...english, naming: "german" })).toBe("Cis4");
  });
});
