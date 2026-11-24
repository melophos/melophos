// the site and the Studio read one set of tokens and one set of fonts. these tests show the site keeps no copy of them.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSite, walk } from "./lib/files.ts";

describe("shared design files", () => {
  it("are imported from the Studio folder", () => {
    const base = readSite("src/app/layout.tsx");
    for (const f of ["tokens.css", "base.css", "fonts/fonts.css"]) expect(base).toContain(`studio/src/styles/${f}`);
  });
  it("are not copied into the site", () => {
    const files = walk("src").concat(walk("public"));
    expect(files.filter((f) => /tokens|\.woff2?$|base\.css/.test(f))).toEqual([]);
    expect(existsSync(join(process.cwd(), "src/styles/tokens.css"))).toBe(false);
  });
});
