// the product rules test: a source scan for patterns this product has decided against (section 4.2).
// run on its own with: npm run check:rules
import { describe, expect, it } from "vitest";
import { parseTokens, type PairsFile } from "../src/styles/tokens-model.ts";
import { read, sourceFiles } from "./lib/files.ts";
import { RULES, fileFromExample, pairUsage, scanFile, scanWith, type Violation } from "./lib/rules.ts";

interface Allowed {
  file: string;
  rule: string;
  reason: string;
}

const allow = JSON.parse(read("tests/design-rules.allow.json")) as Allowed[];
const files = sourceFiles();

describe("each rule matches what it should", () => {
  for (const rule of RULES) {
    it(`${rule.id}: flags every bad example`, () => {
      expect(rule.bad.length, "a rule needs bad examples").toBeGreaterThan(0);
      for (const example of rule.bad) {
        const found = scanWith(rule, fileFromExample(example));
        expect(found.length, `not flagged: ${example.text}`).toBeGreaterThan(0);
      }
    });

    it(`${rule.id}: leaves every good example alone`, () => {
      expect(rule.good.length, "a rule needs good examples").toBeGreaterThan(0);
      for (const example of rule.good) {
        const found = scanWith(rule, fileFromExample(example));
        expect(found, `wrongly flagged: ${example.text}`).toEqual([]);
      }
    });
  }
});

// the pairing check is not a pattern rule, so it joins the same list under its own id
const UNLISTED_PAIR = "unlisted-pair";

function unlistedPairs(): Violation[] {
  const pairs = JSON.parse(read("src/styles/tokens.pairs.json")) as PairsFile;
  const listed = new Set(pairs.pairs.map((p) => `${p.fg}|${p.bg}`));
  return files.flatMap((file) =>
    pairUsage(file)
      .filter((use) => !listed.has(`${use.fg}|${use.bg}`))
      .map((use) => ({
        rule: UNLISTED_PAIR,
        file: file.path,
        line: use.line,
        excerpt: `${use.excerpt} uses ${use.fg} on ${use.bg}, which is not in tokens.pairs.json`,
      })),
  );
}

describe("the product source", () => {
  const all: Violation[] = [...files.flatMap(scanFile), ...unlistedPairs()];
  const isAllowed = (v: Violation) => allow.some((a) => a.file === v.file && a.rule === v.rule);

  it("has no violation outside the allow list", () => {
    const failures = all
      .filter((v) => !isAllowed(v))
      .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.excerpt}`);
    const why = new Map(RULES.map((r) => [r.id, r.why]));
    why.set(UNLISTED_PAIR, "A component may only use a pairing that is listed in tokens.pairs.json");
    const rules = [...new Set(all.filter((v) => !isAllowed(v)).map((v) => v.rule))];
    expect(failures, `\n${failures.join("\n")}\n\n${rules.map((r) => `${r}: ${why.get(r)}`).join("\n")}`).toEqual([]);
  });

  it("keeps the allow list honest: every entry still matches a violation and gives a reason", () => {
    const stale = allow.filter((a) => !all.some((v) => v.file === a.file && v.rule === a.rule));
    expect(stale.map((a) => `${a.file} [${a.rule}]`), "allow-list entries that no longer match").toEqual([]);
    for (const a of allow) {
      expect(a.reason.length, `${a.file} [${a.rule}] has no reason`).toBeGreaterThan(10);
      expect([...RULES.map((r) => r.id), UNLISTED_PAIR], `unknown rule ${a.rule}`).toContain(a.rule);
    }
  });
});

describe("never colour alone", () => {
  interface RoleMap {
    roles: { id: string; token: string | null; shape: string; word: string }[];
    fills: { id: string; token: string; shape: string; word: string }[];
  }
  const map = JSON.parse(read("src/styles/lights.json")) as RoleMap;
  const model = parseTokens(read("src/styles/tokens.css"));

  it("gives every light and key fill token a role with a shape and a word", () => {
    const wanted = Object.keys(model.global).filter((t) => /^--light-/.test(t) || /^--key-.*-fill$/.test(t));
    expect(wanted.length).toBeGreaterThan(0);
    const mapped = new Map<string, { shape: string; word: string }>();
    for (const r of [...map.roles, ...map.fills]) {
      if (r.token) mapped.set(r.token, r);
    }
    const problems = wanted
      .filter((t) => !mapped.get(t)?.shape?.trim() || !mapped.get(t)?.word?.trim())
      .map((t) => `${t} has no shape or no word in lights.json`);
    expect(problems, `\n${problems.join("\n")}`).toEqual([]);
  });
});
