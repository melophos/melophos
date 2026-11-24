// font checks: reads the font files themselves.
// run on its own with: npm run check:fonts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import { scanCss } from "../src/styles/css-scan.ts";
import { fallbackFaces } from "../scripts/font-metrics.ts";
import { ROOT, read } from "./lib/files.ts";

const DIR = "src/styles/fonts";
const fontsCss = scanCss(read(`${DIR}/fonts.css`));
const readme = read(`${DIR}/README.md`);
const required = JSON.parse(read(`${DIR}/required-glyphs.json`)) as {
  text: { ranges: [string, string][]; singles: string[] };
  music: { singles: string[] };
  features: { sans: string[] };
};

interface Face {
  family: string;
  file: string | null;
  range: [number, number][] | null;
  local: string | null;
  decl: Map<string, string>;
}

function parseRange(value: string): [number, number][] {
  return value.split(",").map((part) => {
    const m = /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m?.[1]) throw new Error(`bad unicode-range: ${value}`);
    const lo = parseInt(m[1], 16);
    return [lo, m[2] ? parseInt(m[2], 16) : lo];
  });
}

const faces: Face[] = fontsCss
  .filter((r) => r.selector === "@font-face")
  .map((r) => {
    const decl = new Map(r.declarations.map((d) => [d.prop, d.value]));
    const src = decl.get("src") ?? "";
    const range = decl.get("unicode-range");
    return {
      family: (decl.get("font-family") ?? "").replaceAll('"', ""),
      file: /url\("?\.\/([^")]+)"?\)/.exec(src)?.[1] ?? null,
      range: range ? parseRange(range) : null,
      local: /local\("?([^")]+)"?\)/.exec(src)?.[1] ?? null,
      decl,
    };
  });

const webFaces = faces.filter((f) => f.file !== null);
function open(file: string): fontkit.Font {
  const font = fontkit.create(readFileSync(join(ROOT, DIR, file)));
  if (!("hasGlyphForCodePoint" in font)) throw new Error(`${file} is a font collection`);
  return font;
}
const inRange = (face: Face, cp: number) => face.range === null || face.range.some(([lo, hi]) => cp >= lo && cp <= hi);

function wanted(): { cp: number; music: boolean }[] {
  const out: { cp: number; music: boolean }[] = [];
  for (const [lo, hi] of required.text.ranges) {
    for (let cp = parseInt(lo, 16); cp <= parseInt(hi, 16); cp++) {
      // the no-break space and soft hyphen are layout characters and may have no outline
      if (cp !== 0x00ad && cp !== 0x00a0) out.push({ cp, music: false });
    }
  }
  for (const s of required.text.singles) out.push({ cp: parseInt(s, 16), music: false });
  for (const s of required.music.singles) out.push({ cp: parseInt(s, 16), music: true });
  return out;
}

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

describe("font files", () => {
  it("are all present and each has a licence file beside it", () => {
    expect(webFaces.length).toBeGreaterThan(0);
    for (const face of webFaces) {
      expect(existsSync(join(ROOT, DIR, face.file ?? "")), `${face.file} is missing`).toBe(true);
    }
    for (const licence of [
      "OFL-AtkinsonHyperlegibleNext.txt",
      "OFL-AtkinsonHyperlegibleMono.txt",
      "OFL-MelophosMusicSigns-from-Bravura.txt",
    ]) {
      expect(read(`${DIR}/${licence}`), licence).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    }
  });

  it("have a source, a version and the right SHA-256 recorded in the README", () => {
    const files = [...new Set(webFaces.map((f) => f.file ?? ""))];
    for (const file of files) {
      const row = readme.split("\n").find((line) => line.startsWith(`| \`${file}\``));
      expect(row, `${file} has no row in the fonts README`).toBeDefined();
      const cells = (row ?? "").split("|").map((c) => c.trim());
      const recorded = /`([0-9a-f]{64})`/.exec(cells[cells.length - 2] ?? "")?.[1];
      const actual = createHash("sha256").update(readFileSync(join(ROOT, DIR, file))).digest("hex");
      expect(recorded, `${file}: the README SHA-256 is wrong or missing`).toBe(actual);
      expect(row, `${file}: no source URL`).toMatch(/https:\/\//);
      expect(cells[4] ?? "", `${file}: no version`).toMatch(/^\d+\.\d+/);
    }
  });

  it("keep the weight range of the text fonts at 200 to 800", () => {
    for (const file of ["AtkinsonHyperlegibleNext-Variable.woff2", "AtkinsonHyperlegibleMono-Variable.woff2"]) {
      const axes = open(file).variationAxes as Record<string, { min: number; max: number }>;
      expect([axes["wght"]?.min, axes["wght"]?.max], file).toEqual([200, 800]);
    }
  });

  it("stay small", () => {
    expect(statSync(join(ROOT, DIR, "AtkinsonHyperlegibleNext-Variable.woff2")).size).toBeLessThan(60_000);
    expect(statSync(join(ROOT, DIR, "AtkinsonHyperlegibleMono-Variable.woff2")).size).toBeLessThan(40_000);
    expect(statSync(join(ROOT, DIR, "MelophosMusicSigns.woff2")).size).toBeLessThan(10_000);
  });
});

describe("font glyph check", () => {
  for (const family of ["Atkinson Hyperlegible Next", "Atkinson Hyperlegible Mono"]) {
    it(`gives every required character a glyph in ${family}`, () => {
      const mine = webFaces.filter((f) => f.family === family);
      const fonts = mine.map((f) => ({ face: f, font: open(f.file ?? "") }));
      const missing: string[] = [];
      for (const { cp, music } of wanted()) {
        // the last face that claims a code point wins, as in a browser
        const winner = [...fonts].reverse().find(({ face }) => inRange(face, cp));
        if (!winner) {
          missing.push(`${hex(cp)}: no face in fonts.css covers it`);
        } else if (!winner.font.hasGlyphForCodePoint(cp)) {
          missing.push(`${hex(cp)}${music ? " (music sign)" : ""}: ${winner.face.file} has no glyph`);
        }
      }
      expect(missing, `\n${family} is missing:\n${missing.join("\n")}`).toEqual([]);
    });
  }

  it("has the real sharp, flat and natural signs in the music file", () => {
    const font = open("MelophosMusicSigns.woff2");
    for (const s of required.music.singles) {
      expect(font.hasGlyphForCodePoint(parseInt(s, 16)), `U+${s}`).toBe(true);
    }
  });

  it("shows the text fonts have none of the three signs, which is why the music file exists", () => {
    for (const file of ["AtkinsonHyperlegibleNext-Variable.woff2", "AtkinsonHyperlegibleMono-Variable.woff2"]) {
      const font = open(file);
      const has = required.music.singles.filter((s) => font.hasGlyphForCodePoint(parseInt(s, 16)));
      expect(has, `${file} now has ${has.join(", ")}: the music file may no longer be needed`).toEqual([]);
    }
  });

  it("has the tabular figures feature the counters rely on", () => {
    const features = open("AtkinsonHyperlegibleNext-Variable.woff2").availableFeatures as string[];
    for (const f of required.features.sans) expect(features, f).toContain(f);
  });

  it("does not use the reserved font name Bravura in any name field of the subset", () => {
    const records = (open("MelophosMusicSigns.woff2") as unknown as { name: { records: Record<string, Record<string, string>> } }).name.records;
    const notices = new Set(["copyright", "description", "license", "licenseURL", "manufacturer", "designer", "vendorURL", "designerURL"]);
    const offending = Object.entries(records)
      .filter(([key]) => !notices.has(key))
      .flatMap(([key, value]) => Object.values(value).map((v) => [key, v] as const))
      .filter(([, v]) => /bravura/i.test(v));
    expect(offending, `reserved name in: ${JSON.stringify(offending)}`).toEqual([]);
  });
});

describe("fallback faces", () => {
  it("carry the metrics capsize computes from the font files", async () => {
    const computed = await fallbackFaces();
    for (const [key, family] of [
      ["sans", "Atkinson Hyperlegible Next Fallback"],
      ["mono", "Atkinson Hyperlegible Mono Fallback"],
    ] as const) {
      const face = faces.find((f) => f.family === family);
      expect(face, `${family} is not declared in fonts.css`).toBeDefined();
      const want = computed[key];
      expect(face?.local, family).toBe(want.local);
      expect(face?.decl.get("size-adjust"), `${family} size-adjust`).toBe(want.sizeAdjust);
      expect(face?.decl.get("ascent-override"), `${family} ascent-override`).toBe(want.ascent);
      expect(face?.decl.get("descent-override"), `${family} descent-override`).toBe(want.descent);
      expect(face?.decl.get("line-gap-override"), `${family} line-gap-override`).toBe(want.lineGap);
    }
  });

  it("are named in the font stacks of tokens.css", () => {
    const tokens = read("src/styles/tokens.css");
    expect(tokens).toContain('"Atkinson Hyperlegible Next Fallback"');
    expect(tokens).toContain('"Atkinson Hyperlegible Mono Fallback"');
  });
});
