// computes the fallback font metrics with capsize, so the text does not jump when the web font arrives.
// run with: npm run fonts:metrics
// the figures printed here are the ones in src/styles/fonts/fonts.css.
// tests/fonts.test.ts compares them.

import { createFontStack } from "@capsizecss/core";
import courierNew from "@capsizecss/metrics/courierNew";
import verdana from "@capsizecss/metrics/verdana";
import { fromFile } from "@capsizecss/unpack/fs";
import { fileURLToPath } from "node:url";

export interface FallbackFace {
  family: string;
  local: string;
  sizeAdjust: string;
  ascent: string;
  descent: string;
  lineGap: string;
}

const FONTS = new URL("../src/styles/fonts/", import.meta.url);

async function face(file: string, family: string, fallback: typeof verdana, local: string): Promise<FallbackFace> {
  const metrics = await fromFile(fileURLToPath(new URL(file, FONTS)));
  const stack = createFontStack([{ ...metrics, familyName: family }, fallback]);
  const css = stack.fontFaces;
  const read = (prop: string): string => new RegExp(`${prop}:\\s*([\\d.]+%)`).exec(css)?.[1] ?? "0%";
  return {
    family: `${family} Fallback`,
    local,
    sizeAdjust: read("size-adjust"),
    ascent: read("ascent-override"),
    descent: read("descent-override"),
    lineGap: read("line-gap-override"),
  };
}

export async function fallbackFaces(): Promise<{ sans: FallbackFace; mono: FallbackFace }> {
  return {
    sans: await face("AtkinsonHyperlegibleNext-Variable.woff2", "Atkinson Hyperlegible Next", verdana, "Verdana"),
    mono: await face("AtkinsonHyperlegibleMono-Variable.woff2", "Atkinson Hyperlegible Mono", courierNew, "Courier New"),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const faces = await fallbackFaces();
  for (const f of [faces.sans, faces.mono]) {
    console.log(`${f.family}: local("${f.local}") size-adjust ${f.sizeAdjust}, ascent ${f.ascent}, descent ${f.descent}, line gap ${f.lineGap}`);
  }
}
