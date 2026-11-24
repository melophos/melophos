// shared by the tests: loads the module from the built package and reads the corpus
// that the Rust tests use, so both sides are held to the same files.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync, type FollowConfig, type FollowEvent, type Hand, type Note } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const fixtureDir = join(here, "..", "..", "..", "fixtures");

export function moduleBytes(): Buffer {
  return readFileSync(join(here, "..", "pkg", "melophos_core_wasm_bg.wasm"));
}

export function loadModule(): void {
  initSync(moduleBytes());
}

export interface Case {
  /** file name and case name, as golden.json keys them */
  key: string;
  config: FollowConfig;
  expected: Note[];
  played: Note[];
}

export interface Golden {
  score: Record<string, number | null>;
  events: number;
  digest: string;
  follow: Record<string, number | null>;
}

type Raw = {
  name: string;
  config: { window_ms: number; band: number; pause_ms: number; chord_ms: number; relocate_after: number };
  expected: [number, number][];
  hands: (Hand | null)[] | null;
  cases: { name: string; played: [number, number][] }[];
};

export function corpus(): Case[] {
  const out: Case[] = [];
  const files = ["corpus", "final"].flatMap((d) =>
    readdirSync(join(fixtureDir, d))
      .filter((x) => x.endsWith(".json"))
      .map((x) => join(fixtureDir, d, x)),
  );
  for (const file of files.sort()) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Raw;
    const expected: Note[] = raw.expected.map(([tMs, note], i) => {
      const hand = raw.hands?.[i];
      return hand ? { tMs, note, hand } : { tMs, note };
    });
    const c = raw.config;
    const config: FollowConfig = {
      windowMs: c.window_ms,
      band: c.band,
      pauseMs: c.pause_ms,
      chordMs: c.chord_ms,
      relocateAfter: c.relocate_after,
    };
    for (const k of raw.cases) {
      out.push({ key: `${raw.name}/${k.name}`, config, expected, played: k.played.map(([tMs, note]) => ({ tMs, note })) });
    }
  }
  return out;
}

export function golden(): Record<string, Golden> {
  return JSON.parse(readFileSync(join(fixtureDir, "golden.json"), "utf8")) as Record<string, Golden>;
}

const kinds = ["hit", "wrong", "late", "repeat", "unsure"];

/** FNV-1a over every number of every event, each as 8 little-endian bytes, as the Rust test computes it. */
export function digest(events: FollowEvent[]): string {
  const mask = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (const e of events) {
    for (const v of [e.playedIndex, kinds.indexOf(e.kind), e.expectedIndex ?? -1, e.position, e.errorMs, e.speedPpm, e.jumpedFrom ?? -1]) {
      let x = BigInt.asUintN(64, BigInt(v));
      for (let b = 0; b < 8; b++) {
        h ^= x & 0xffn;
        h = (h * 0x100000001b3n) & mask;
        x >>= 8n;
      }
    }
  }
  return h.toString(16).padStart(16, "0");
}
