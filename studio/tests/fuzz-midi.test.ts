// a seeded fuzz of the MIDI reader. FUZZ_SECONDS sets how long it runs: 3 seconds in the normal tests and 120 for
// `npm run fuzz:midi`. every input must give a song inside the limits or a MidiError and never another error or a hang.
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAX_DURATION_MS, MAX_NOTES, MidiError, parseMidi } from "../src/midi-file";
import { splitHands } from "../src/hands";
import { randomSong, seeded } from "./lib/smf";

const SECONDS = Number(process.env["FUZZ_SECONDS"] ?? 3);
const SEED = Number(process.env["FUZZ_SEED"] ?? 20261122);

function mutate(base: Uint8Array, random: () => number): Uint8Array {
  const out = Array.from(base);
  const kind = Math.floor(random() * 7);
  const at = (): number => Math.floor(random() * Math.max(1, out.length));
  switch (kind) {
    case 0:
      for (let i = 0, n = 1 + Math.floor(random() * 8); i < n; i++) out[at()] = Math.floor(random() * 256);
      break;
    case 1:
      out.length = at();
      break;
    case 2:
      out.splice(at(), Math.floor(random() * 20));
      break;
    case 3:
      out.splice(at(), 0, ...Array.from({ length: 1 + Math.floor(random() * 30) }, () => Math.floor(random() * 256)));
      break;
    case 4: {
      // a length field made enormous
      const i = at();
      for (let k = 0; k < 4; k++) out[i + k] = 0xff;
      break;
    }
    case 5:
      // a header count or division changed
      out[10 + Math.floor(random() * 4)] = Math.floor(random() * 256);
      break;
    default:
      return Uint8Array.from({ length: Math.floor(random() * 400) }, () => Math.floor(random() * 256));
  }
  return Uint8Array.from(out);
}

describe("fuzzing the MIDI reader", () => {
  it(`survives ${SECONDS} seconds of damaged and random files`, () => {
    const random = seeded(SEED);
    const bases = Array.from({ length: 24 }, () => randomSong(random));
    const stop = Date.now() + SECONDS * 1000;
    let runs = 0;
    let accepted = 0;
    let slowest = 0;
    while (Date.now() < stop) {
      const input = mutate(bases[Math.floor(random() * bases.length)] ?? bases[0]!, random);
      const began = performance.now();
      try {
        const song = parseMidi(input);
        accepted += 1;
        expect(song.notes.length).toBeGreaterThan(0);
        expect(song.notes.length).toBeLessThanOrEqual(MAX_NOTES);
        expect(song.lengthMs).toBeLessThanOrEqual(MAX_DURATION_MS);
        for (const n of song.notes) {
          expect(n.note >= 0 && n.note <= 127).toBe(true);
          expect(n.tMs >= 0 && n.durMs >= 1).toBe(true);
        }
        expect(splitHands(song).hands).toHaveLength(song.notes.length);
      } catch (error) {
        if (!(error instanceof MidiError)) throw new Error(`seed ${SEED}, run ${runs}: ${String(error)}`);
      }
      slowest = Math.max(slowest, performance.now() - began);
      runs += 1;
    }
    mkdirSync(".fuzz", { recursive: true });
    writeFileSync(".fuzz/last.txt", `${SECONDS} seconds, seed ${SEED}: ${runs} files, ${accepted} accepted, slowest ${slowest.toFixed(1)} ms\n`);
    expect(runs).toBeGreaterThan(100);
    expect(slowest).toBeLessThan(1000);
  }, (SECONDS + 30) * 1000);
});
