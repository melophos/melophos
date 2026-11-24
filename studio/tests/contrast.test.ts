// contrast from the tokens: reads tokens.css and tokens.pairs.json and measures every listed pairing in every set.
// run on its own with: npm run check:contrast
import { describe, expect, it } from "vitest";
import { round2 } from "../src/styles/colour.ts";
import {
  SET_NAMES,
  evaluatePairs,
  parseTokens,
  specFigure,
  tokenValue,
  type PairsFile,
} from "../src/styles/tokens-model.ts";
import { read } from "./lib/files.ts";

const css = read("src/styles/tokens.css");
const pairsFile = JSON.parse(read("src/styles/tokens.pairs.json")) as PairsFile;
const model = parseTokens(css);

describe("tokens.css", () => {
  it("defines each of the four sets and its blocks agree", () => {
    expect(model.problems, model.problems.join("\n")).toEqual([]);
    for (const set of SET_NAMES) {
      expect(model.blocks[set], `set ${set} has no block`).toBeGreaterThan(0);
    }
  });

  it("gives every set the same token names", () => {
    const reference = Object.keys(model.sets.light).sort();
    for (const set of SET_NAMES) {
      expect(Object.keys(model.sets[set]).sort(), `set ${set} differs from light`).toEqual(reference);
    }
  });

  it("sets the focus gap to the canvas colour in every set", () => {
    for (const set of SET_NAMES) {
      expect(tokenValue(model, set, "--focus-gap"), set).toBe(tokenValue(model, set, "--canvas"));
    }
  });

  it("uses every colour token in at least one listed pairing", () => {
    const used = new Set(pairsFile.pairs.flatMap((p) => [p.fg, p.bg]));
    const colours = [...Object.keys(model.sets.light), ...Object.keys(model.global)].filter((name) => {
      const v = tokenValue(model, "light", name);
      return v !== undefined && /^#[0-9a-f]{6}$/i.test(v);
    });
    const unmeasured = colours.filter((name) => !used.has(name));
    expect(unmeasured, `colour tokens with no listed pairing: ${unmeasured.join(", ")}`).toEqual([]);
  });
});

describe("tokens.pairs.json", () => {
  it("has unique ids and known roles", () => {
    const ids = pairsFile.pairs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of pairsFile.pairs) {
      expect(Object.keys(pairsFile.roles), p.id).toContain(p.role);
    }
  });

  it("meets the minimum ratio of its role in every set", () => {
    const failures = evaluatePairs(model, pairsFile)
      .filter((r) => !r.passes)
      .map(
        (r) =>
          `${r.set}: ${r.pair.id} (${r.pair.fg} ${r.fg} on ${r.pair.bg} ${r.bg}) is ${r.ratio.toFixed(2)}:1, ` +
          `${r.pair.role} needs ${r.minimum}:1`,
      );
    expect(failures, `\n${failures.join("\n")}`).toEqual([]);
  });

  it("reproduces every contrast figure the specification prints", () => {
    const differences: string[] = [];
    let compared = 0;
    for (const r of evaluatePairs(model, pairsFile)) {
      const spec = specFigure(r.pair, r.set);
      if (spec === undefined) continue;
      compared++;
      if (round2(r.ratio) !== spec) {
        differences.push(`${r.set}: ${r.pair.id} measures ${round2(r.ratio).toFixed(2)}:1 and the spec says ${spec.toFixed(2)}:1`);
      }
    }
    expect(compared, "no spec figures were compared").toBeGreaterThan(60);
    expect(differences, `\n${differences.join("\n")}`).toEqual([]);
  });

  it("keeps the five pairings the spec names under 7:1 and over 4.5:1", () => {
    const under = evaluatePairs(model, pairsFile)
      .filter((r) => (r.set === "dark" || r.set === "light") && r.pair.role !== "decorative" && r.pair.role !== "mark" && r.ratio < 7)
      .map((r) => `${r.set}: ${r.pair.id}`)
      .sort();
    expect(under).toEqual([
      "dark: problem-on-surface",
      "dark: problem-on-surface-alt",
      "light: accent-text-on-surface-alt",
      "light: left-on-surface-alt",
      "light: problem-on-surface-alt",
    ]);
  });
});
