import { describe, expect, it } from "vitest";

import { hrefFor, intParam, parseHash } from "./router";

describe("router", () => {
  it("reads a path and its query", () => {
    const r = parseHash("#/practise/twinkle?mode=rhythm&hand=left&from=3");
    expect(r.parts).toEqual(["practise", "twinkle"]);
    expect(r.query.get("mode")).toBe("rhythm");
    expect(intParam(r.query, "from", 1, 99)).toBe(3);
  });

  it("treats an empty hash as the start", () => {
    expect(parseHash("").parts).toEqual([]);
    expect(parseHash("#/").parts).toEqual([]);
  });

  it("builds an address and leaves out empty values", () => {
    expect(hrefFor(["practise", "a b"], { mode: "melody", from: null, hand: "" })).toBe("#/practise/a%20b?mode=melody");
  });

  it("rejects a number out of bounds or not a number", () => {
    const q = new URLSearchParams("a=500&b=abc&c=-2&d=7");
    expect(intParam(q, "a", 1, 99)).toBeNull();
    expect(intParam(q, "b", 1, 99)).toBeNull();
    expect(intParam(q, "c", 1, 99)).toBeNull();
    expect(intParam(q, "d", 1, 99)).toBe(7);
  });

  it("survives a broken escape", () => {
    expect(parseHash("#/a/%E0%A4%A").parts).toEqual(["a", "%E0%A4%A"]);
  });
});
