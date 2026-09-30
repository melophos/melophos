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
