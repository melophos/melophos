// the light table beside the tokens: the screen colours match tokens.css and the firmware table has not drifted unseen.
// the firmware check runs in the monorepo and is skipped in the published Studio copy, which has no firmware folder.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTokens, tokenValue } from "../src/styles/tokens-model.ts";
import { ROOT, read } from "./lib/files.ts";

interface Lights {
  roles: { id: string; token: string | null }[];
  firmwareCurrent: Record<string, [number, number, number]>;
}

const lights = JSON.parse(read("src/styles/lights.json")) as Lights;
const model = parseTokens(read("src/styles/tokens.css"));
const FIRMWARE = new URL("../firmware/lib/practice/render.cpp", `file://${ROOT}`).pathname;

describe("light role map", () => {
  it("names only tokens that exist", () => {
    for (const r of lights.roles) {
      if (r.token) expect(tokenValue(model, "light", r.token), `${r.id}: ${r.token}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.skipIf(!existsSync(FIRMWARE))("matches the colours firmware/lib/practice/render.cpp holds today", () => {
    const source = readFileSync(FIRMWARE, "utf8");
    const base: Record<string, number[]> = {};
    for (const m of source.matchAll(/const uint8_t k(Blue|Amber|Red)\[3\]\s*=\s*\{(\d+),\s*(\d+),\s*(\d+)\}/g)) {
      base[m[1] ?? ""] = [Number(m[2]), Number(m[3]), Number(m[4])];
    }
    // the one place that maps the firmware's constants to roles. render.cpp kept the names kBlue, kAmber and kRed, but kRed now
    // holds the rose-magenta of a wrong note and kBlue is the left hand's guide. the names mislead, the meanings are these
    const ROLE_OF_CONSTANT = { Amber: ["GuideRight", "Played"], Blue: ["GuideLeft"], Red: ["Wrong"] } as const;
    const found: Record<string, number[] | undefined> = {};
    for (const [constant, roles] of Object.entries(ROLE_OF_CONSTANT)) for (const role of roles) found[role] = base[constant];
    expect(found, "the firmware changed: update firmwareCurrent in lights.json and the table in src/styles/README.md").toEqual(lights.firmwareCurrent);
  });
});
