// the hashed name check has to catch a name wherever it sits in ordinary text and stay quiet otherwise. the tests use
// stand-in names hashed here, so no real name is written into the repository
import { describe, expect, it } from "vitest";
import { candidates, hashedHits, hashOf } from "../src/lib/hashed-names.ts";

const set = (...names: string[]): ReadonlySet<string> => new Set(names.map(hashOf));

describe("hashed names", () => {
  it("finds a name as a word, inside a link, a path and a domain, in any case", () => {
    const hashes = set("wobblecart");
    expect(hashedHits("Ask Wobblecart first.", hashes)).toEqual(["wobblecart"]);
    expect(hashedHits("see https://github.com/wobblecart/notes", hashes)).toContain("wobblecart");
    expect(hashedHits("mail me at hello@wobblecart.example", hashes)).toContain("wobblecart");
  });

  it("finds a name made of two words or a folder and a file", () => {
    expect(hashedHits("ask the other gardener today", set("other gardener"))).toEqual(["other gardener"]);
    expect(hashedHits("kept in notes/diary/2026.md", set("notes/diary"))).toEqual(["notes/diary"]);
    expect(hashedHits("the night’s plan", set("night's plan"))).toEqual(["night's plan"]);
  });

  it("does not flag a word that only contains the name or sits near it", () => {
    const hashes = set("cart");
    expect(hashedHits("a wobblecart and a carton", hashes)).toEqual([]);
    expect(hashedHits("", hashes)).toEqual([]);
  });

  it("splits text into the parts a name could hide in", () => {
    const c = candidates("Visit https://a.example/b/c now");
    for (const part of ["a.example", "a", "example", "b", "c", "a.example/b", "b/c", "visit https", "now"]) expect(c.has(part), part).toBe(true);
  });
});
