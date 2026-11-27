// the site builds and tests from this repository alone. nothing in its code or tests may read a sibling checkout or name a
// repository that is not public and the reader refuses a path that leaves the repository.
import { describe, expect, it } from "vitest";
import { readRepo } from "../src/lib/repo.ts";
import { HERMETIC_NAME_HASHES, hashedHits } from "../src/lib/hashed-names.ts";
import { readSite, walk } from "./lib/files.ts";

const files = [...walk("src"), ...walk("tests"), ...walk("scripts"), ...walk("public"), "README.md", "package.json"].filter((f) => /\.(ts|tsx|js|css|json|md|txt)$/.test(f) && !f.startsWith("tests/lib/"));

describe("the site stands on this repository alone", () => {
  for (const f of files) {
    it(`${f} names no private repository and no one else at work`, () => {
      const text = readSite(f);
      // the names are held as hashes, so the test reports the words it found and never spells out the list
      expect(hashedHits(text, HERMETIC_NAME_HASHES), `${f} mentions a private name`).toEqual([]);
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
