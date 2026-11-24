// one list of status words for the whole site. the home page, the roadmap, the accessibility page, how it works and the
// published documents use these words and no others and a gap that nobody has checked uses the word Not yet checked.
import { describe, expect, it } from "vitest";
import { STATUS_MEANING, STATUS_ORDER, STATUS_WORD } from "../src/data/status.ts";
import { roadmap } from "../src/lib/roadmap.ts";
import { readRoot, readSite, walk } from "./lib/files.ts";

describe("the list", () => {
  it("has a word and a meaning for every status and no two words alike", () => {
    expect(new Set(STATUS_ORDER).size).toBe(7);
    expect(new Set(Object.values(STATUS_WORD)).size).toBe(7);
    for (const s of STATUS_ORDER) expect(STATUS_MEANING[s].length).toBeGreaterThan(20);
  });
  it("has the word for a gap nobody has checked", () => {
    expect(STATUS_WORD.unchecked).toBe("Not yet checked");
  });
});

describe("every page uses only the list", () => {
  const pages = walk("src/app").filter((p) => p.endsWith(".tsx"));
  it("passes a status that is a key of the list", () => {
    const keys = new Set(STATUS_ORDER as string[]);
    for (const f of pages) for (const m of readSite(f).matchAll(/<Status status="(\w+)"/g)) expect(keys.has(m[1] ?? ""), `${f}: ${m[1]}`).toBe(true);
  });
  it("never writes a status word of its own in the place of a mark", () => {
    for (const f of pages) {
      const text = readSite(f);
      for (const word of ["Not built", "Done", "Coming soon", "Experimental", "Beta", "Partially built", "Work in progress"]) expect(text, `${f} uses "${word}"`).not.toContain(`>${word}<`);
    }
  });
  it("the accessibility page marks every gap nobody has checked with the one word", () => {
    const text = readSite("src/app/accessibility/page.tsx");
    expect(text).toMatch(/No person who uses a screen reader/);
    expect(text).toMatch(/<Status status="unchecked" \/> No person who uses a screen reader/);
  });
});

describe("the roadmap document uses the list", () => {
  it("explains each note word it uses and every status in the list is reachable", () => {
    const doc = readRoot("docs/roadmap.md");
    for (const word of ["host-tested, awaits a board", "in progress", "not yet checked"]) expect(doc).toContain(`"(${word})"`);
    const used = new Set(roadmap().versions.flatMap((v) => v.groups.flatMap((g) => g.items.map((i) => i.status))));
    for (const s of ["built", "host", "progress", "planned", "unchecked"] as const) expect(used.has(s), s).toBe(true);
  });
});

describe("the overview and the architecture document use the list", () => {
  const words = Object.values(STATUS_WORD).map((w) => w.toLowerCase());
  it("overview names every word it explains", () => {
    const doc = readRoot("docs/overview.md").toLowerCase();
    for (const w of ["built", "host-tested, awaits a board", "not yet checked"]) expect(doc).toContain(w);
  });
  it("every row of the overview's table carries a word from the list", () => {
    const rows = readRoot("docs/overview.md").split("\n").filter((l) => /^\| (Guidance|Feedback|Instruments|Inputs|Practice data|Scoring|Songs|Integrations) \|/.test(l));
    expect(rows.length).toBe(8);
    for (const row of rows) {
      const status = row.split("|").map((c) => c.trim())[3]?.toLowerCase() ?? "";
      expect(words.some((w) => status.includes(w)), row).toBe(true);
    }
  });
});
