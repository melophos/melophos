// the writing rules for everything a person reads: no em dash, no en dash and no comma before "and" or "or", including
// across a line break. this scans the interface text in the source, the pages and the README. the product rules test never
// did, so an em dash added to a view passed. the examples at the top prove the scan catches each fault.
import { describe, expect, it } from "vitest";
import { read, walk } from "./lib/files.ts";

export interface Fault {
  rule: string;
  line: number;
  excerpt: string;
}

export function wordingFaults(text: string): Fault[] {
  const out: Fault[] = [];
  const line = (i: number): number => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(/[–—]/g)) out.push({ rule: "dash", line: line(m.index), excerpt: text.slice(Math.max(0, m.index - 20), m.index + 20) });
  for (const m of text.matchAll(/,\s+(?:and|or)\b/g)) out.push({ rule: "comma before and or or", line: line(m.index), excerpt: m[0].replace(/\s+/g, " ") });
  return out;
}

describe("the scan itself", () => {
  it("finds an em dash, an en dash and a comma before and or or, also across a line break", () => {
    expect(wordingFaults("A — B").map((f) => f.rule)).toEqual(["dash"]);
    expect(wordingFaults("1–5").map((f) => f.rule)).toEqual(["dash"]);
    expect(wordingFaults("red, and blue").map((f) => f.rule)).toEqual(["comma before and or or"]);
    expect(wordingFaults("red,\n  or blue").map((f) => f.rule)).toEqual(["comma before and or or"]);
    expect(wordingFaults("red and blue, then green")).toEqual([]);
  });
});

describe("the words of the Studio", () => {
  const files = [
    ...walk("src").filter((p) => /\.(tsx?|css|json|md)$/.test(p) && !p.includes("/fonts/") && !p.endsWith(".test.ts")),
    "index.html",
    "specimen.html",
    "README.md",
    "sw.template.js",
    "vite.config.ts",
    "public/manifest.webmanifest",
    "public/_headers",
  ];
  for (const path of files) {
    it(`${path} follows the writing rules`, () => {
      let text: string;
      try {
        text = read(path);
      } catch {
        return;
      }
      expect(wordingFaults(text), path).toEqual([]);
    });
  }
});
