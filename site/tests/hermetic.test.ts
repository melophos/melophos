// the site builds and tests from this repository alone. nothing in its code or tests may read a sibling checkout or name a
// repository that is not public and the reader refuses a path that leaves the repository.
import { describe, expect, it } from "vitest";
import { readRepo } from "../src/lib/repo.ts";
import { readSite, walk } from "./lib/files.ts";

// built from pieces so that this file does not contain the words it forbids
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "a private repository", pattern: new RegExp(["melophos", "internal"].join("-"), "i") },
  { name: "a note about someone else working in the repository", pattern: new RegExp(["another", "builder"].join(" "), "i") },
  { name: "a note about others at work", pattern: new RegExp(["other", "builders?"].join(" "), "i") },
  { name: "a journal", pattern: /docs\/journal/ },
  { name: "the owner's distance check", pattern: new RegExp(["owner's", "check"].join(" "), "i") },
];

const files = [...walk("src"), ...walk("tests"), ...walk("scripts"), ...walk("public"), "README.md", "package.json"].filter((f) => /\.(ts|tsx|js|css|json|md|txt)$/.test(f) && !f.startsWith("tests/lib/"));

describe("the site stands on this repository alone", () => {
  for (const f of files) {
    it(`${f} names no private repository and no one else at work`, () => {
      const text = readSite(f);
      for (const { name, pattern } of FORBIDDEN) expect(pattern.test(text), `${f} mentions ${name}`).toBe(false);
    });
  }

  it("reads no path that leaves the repository", () => {
    for (const f of walk("src").filter((p) => /\.(ts|tsx)$/.test(p))) {
      const text = readSite(f);
      // a read of the repository goes through readRepo. an import of ../../../ may only reach studio, assets or core
      for (const m of text.matchAll(/readRepo\(\s*["'`](\.\.[^"'`]*)["'`]/g)) expect.fail(`${f} reads ${m[1]} outside the repository`);
    }
  });

  it("refuses to read a sibling folder", () => {
    expect(() => readRepo("../elsewhere/file.md")).toThrow(/outside this repository/);
    expect(() => readRepo("docs/../../elsewhere")).toThrow(/outside this repository/);
    expect(readRepo("docs/README.md").length).toBeGreaterThan(10);
  });
});
