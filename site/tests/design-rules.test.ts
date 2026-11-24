// the studio's product rules (section 4.2), run over the site's own source. the rules and their examples live in
// studio/tests/lib/rules.ts and are read from there, so the two surfaces are held to one set.
import { describe, expect, it } from "vitest";
import { RULES, pairUsage, scanFile, type Kind, type SourceFile } from "../../studio/tests/lib/rules.ts";
import { parseTokens, type PairsFile } from "../../studio/src/styles/tokens-model.ts";
import { readRoot, readSite, walk } from "./lib/files.ts";

const KINDS: Record<string, Kind> = { ".css": "css", ".ts": "ts", ".tsx": "ts" };

function sources(): SourceFile[] {
  return walk("src")
    .filter((p) => KINDS[p.slice(p.lastIndexOf("."))] !== undefined)
    .map((path) => ({ path, kind: KINDS[path.slice(path.lastIndexOf("."))] as Kind, text: readSite(path) }));
}

describe("the site source", () => {
  const files = sources();
  it("has files to scan", () => expect(files.length).toBeGreaterThan(10));

  it("breaks none of the product rules", () => {
    const found = files.flatMap(scanFile).map((v) => `${v.file}:${v.line} [${v.rule}] ${v.excerpt}`);
    expect(found, `\n${found.join("\n")}`).toEqual([]);
  });

  it("uses only colour pairs that the contrast test measures", () => {
    const pairs = JSON.parse(readRoot("studio/src/styles/tokens.pairs.json")) as PairsFile;
    const listed = new Set(pairs.pairs.map((p) => `${p.fg}|${p.bg}`));
    const bad = files.flatMap((f) => pairUsage(f).filter((u) => !listed.has(`${u.fg}|${u.bg}`)).map((u) => `${f.path}:${u.line} ${u.fg} on ${u.bg}`));
    expect(bad, `\n${bad.join("\n")}`).toEqual([]);
  });

  it("defines no token of its own: every custom property comes from the shared tokens", () => {
    const shared = parseTokens(readRoot("studio/src/styles/tokens.css"));
    const known = new Set([...Object.keys(shared.global), ...Object.values(shared.sets).flatMap((s) => Object.keys(s))]);
    const used = files.filter((f) => f.kind === "css").flatMap((f) => [...f.text.matchAll(/var\((--[\w-]+)\)/g)].map((m) => `${f.path} ${m[1]}`));
    const missing = used.filter((u) => !known.has(u.split(" ")[1] ?? ""));
    expect(missing).toEqual([]);
  });
});
