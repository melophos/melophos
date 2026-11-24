// drives the real PracticeSession in Node with a clock the test moves by hand and the real WebAssembly engine.
// the page, the canvas and the audio are stubs: what is under test is the stepping, the clock and the scoring.
import { readFileSync } from "node:fs";
import { initSync } from "@melophos/core";
import { markScoringReady } from "../../src/scoring";
import { PracticeSession, type Deps, type SessionConfig } from "../../src/instrument/session";
import { beatMs, excerpt } from "../../src/piece";
import { SONGS } from "../../src/songs";

export function loadEngine(): void {
  initSync(new Uint8Array(readFileSync(`${process.cwd()}/node_modules/@melophos/core/pkg/melophos_core_wasm_bg.wasm`)));
  markScoringReady();
}

export const world = { clock: 0, raf: [] as ((t: number) => void)[] };
const g = globalThis as Record<string, unknown>;
g["document"] = { hidden: false, addEventListener() {}, removeEventListener() {} };
g["window"] = {};
g["requestAnimationFrame"] = (f: (t: number) => void) => {
  world.raf.push(f);
  return world.raf.length;
};
g["cancelAnimationFrame"] = () => {
  world.raf = [];
};

export interface Stub {
  onLost: (() => void) | null;
  spoken: string[];
  calls: string[];
  running: boolean;
}

export function make(over: Partial<SessionConfig> & { songId: string }, extra: Partial<Deps> = {}): { s: PracticeSession; song: (typeof SONGS)[number]; synth: Stub } {
  const song = SONGS.find((x) => x.id === over.songId)!;
  const synth: Stub = { onLost: null, spoken: [], calls: [], running: false };
  const bag = synth as unknown as Record<string | symbol, unknown>;
  const synthStub = new Proxy(bag, { get: (t, k) => (k in t ? t[k] : typeof k === "string" ? () => (synth.calls.push(`${k}`), undefined) : undefined), set: (t, k, v) => ((t[k] = v), true) });
  const cfg: SessionConfig = { song, mode: "rhythm", hand: "both", fromBar: null, toBar: null, speed: 1, loop: false, simulated: false, guidance: "lane", metronome: false, wrongSound: false, keySound: false, silent: false, spoken: false, onlineVoice: false, reducedMotion: false, names: { naming: "english", octave: "c4", accidental: "sharp" }, calibrationMs: null, lightSensitivity: false, ...over };
  const stub = new Proxy({}, { get: (_t, k) => (k === "slot" ? {} : () => undefined) });
  const s = new PracticeSession(cfg, { keyboard: stub as never, lane: null, synth: synthStub as never, now: () => world.clock, ...extra });
  return { s, song, synth };
}

export function advance(to: number, step = 16): void {
  while (world.clock < to) {
    world.clock = Math.min(to, world.clock + step);
    const q = world.raf;
    world.raf = [];
    q.forEach((f) => f(world.clock));
  }
}

// plays notes at their written times from a clock origin, as a perfect player would
export function playPerfect(s: PracticeSession, notes: { note: number; startBeat: number }[], origin: number, msPerBeat: number, source: "midi" | "screen" = "midi"): void {
  for (const n of notes) {
    advance(origin + n.startBeat * msPerBeat);
    s.input(n.note, true, world.clock, source);
    s.input(n.note, false, world.clock + 50, source);
  }
}

export { beatMs, excerpt };
