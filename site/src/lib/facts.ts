// the figures the site states, each read from the file that holds it when the site is built. a page never keeps its
// own copy of a figure, so a change in the source changes the page and a change that breaks the pattern fails the
// build and the tests. verify-dist.ts then checks that each page that must state a figure does.

import { readRepo, repoExists } from "./repo.ts";
import { filesUnder } from "./checks.ts";
import { ROOT } from "./repo.ts";

interface Source {
  file: string;
  // one capture group holding the number
  pattern: string;
  // the captured text is a product such as "2 * 60 * 60 * 1000" and is worked out before the divisor is applied
  product?: boolean;
  // the same limit as the server states it, for a figure the page calls shared. the two must be equal
  server?: { file: string; pattern: string };
  // the number is divided by this to give the unit the page uses. 1 for none
  per?: number;
  // the unit the page states, so a figure is never printed without one
  unit: string;
}

export const FACT_SOURCES = {
  ledCeilingMa: { file: "firmware/lib/practice/render.h", pattern: "kLedCurrentCeilingMa = (\\d+);", unit: "mA" },
  idleGapMinutes: { file: "firmware/lib/publish/publish.h", pattern: "kIdleGapMs = (\\d+);", per: 60000, unit: "minutes" },
  bpmMin: { file: "firmware/lib/practice/practice.cpp", pattern: "settings\\.bpm < (\\d+)", unit: "beats a minute" },
  bpmMax: { file: "firmware/lib/practice/practice.cpp", pattern: "settings\\.bpm > (\\d+)", unit: "beats a minute" },
  wrongBlinkPeriodMs: { file: "firmware/lib/practice/practice.h", pattern: "kWrongBlinkPeriodMs = (\\d+);", unit: "ms" },
  speedMinPercent: { file: "studio/src/clock.ts", pattern: "MIN_SPEED = ([\\d.]+);", per: 0.01, unit: "per cent" },
  speedMaxPercent: { file: "studio/src/clock.ts", pattern: "MAX_SPEED = ([\\d.]+);", per: 0.01, unit: "per cent" },
  midiMaxMiB: { file: "studio/src/midi-file.ts", pattern: "MAX_BYTES = ([\\d_ *]+);", product: true, per: 1024 * 1024, server: { file: "server/app/midi.py", pattern: "MAX_BYTES = ([\\d_ *]+)" }, unit: "MiB" },
  midiMaxTracks: { file: "studio/src/midi-file.ts", pattern: "MAX_TRACKS = (\\d+);", server: { file: "server/app/midi.py", pattern: "MAX_TRACKS = (\\d+)" }, unit: "tracks" },
  midiMaxNotes: { file: "studio/src/midi-file.ts", pattern: "MAX_NOTES = ([\\d_]+);", server: { file: "server/app/midi.py", pattern: "MAX_NOTES = ([\\d_]+)" }, unit: "notes" },
  midiMaxHours: { file: "studio/src/midi-file.ts", pattern: "MAX_DURATION_MS = ([\\d_ *]+);", product: true, per: 3_600_000, server: { file: "server/app/midi.py", pattern: "MAX_DURATION_MS = ([\\d_ *]+)" }, unit: "hours" },
  scoreWindowMs: { file: "core/src/follow.rs", pattern: "window_ms: (\\d+),", unit: "ms" },
} satisfies Record<string, Source>;

export type FactId = keyof typeof FACT_SOURCES;

function read(id: FactId, source: Source, file: string, pattern: string): number {
  const m = new RegExp(pattern).exec(readRepo(file));
  if (!m?.[1]) throw new Error(`the figure "${id}" is no longer in ${file} (pattern ${pattern}): read the source again and update site/src/lib/facts.ts`);
  const raw = m[1].replaceAll("_", "").trim();
  const base = source.product ? raw.split("*").reduce((product, part) => product * Number(part.trim()), 1) : Number(raw);
  // the division is rounded away from floating point noise, then the result must be a figure a person would write
  const n = Math.round((base / (source.per ?? 1)) * 1e6) / 1e6;
  if (!Number.isFinite(n) || n <= 0 || String(n).replace(".", "").length > 6) throw new Error(`the figure "${id}" in ${file} reads as ${n}, which is not a sensible number`);
  return n;
}

export function fact(id: FactId): number {
  const source: Source = FACT_SOURCES[id];
  return read(id, source, source.file, source.pattern);
}

// the figures the page calls shared with the server, each read from the server's own source
export function sharedIds(): FactId[] {
  return (Object.keys(FACT_SOURCES) as FactId[]).filter((id) => (FACT_SOURCES[id] as Source).server !== undefined);
}

export function serverFact(id: FactId): number {
  const source: Source = FACT_SOURCES[id];
  if (!source.server) throw new Error(`${id} has no server source`);
  return read(id, source, source.server.file, source.server.pattern);
}

// the build stops when a limit the page calls shared differs between the Studio and the server
export function assertSharedLimits(): void {
  for (const id of sharedIds()) {
    if (fact(id) !== serverFact(id)) throw new Error(`the Studio's ${id} is ${fact(id)} and the server's is ${serverFact(id)}: the page says they are the same limits`);
  }
}

// a figure as the page prints it: the number with thousands separators and its unit
export const figure = (id: FactId): string => `${fact(id).toLocaleString("en-GB")} ${FACT_SOURCES[id].unit}`;

// small numbers as words, for sentences that start with a count
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const numberWord = (n: number): string => WORDS[n] ?? String(n);

// the number of instrument profiles: every JSON file in profiles/ except the schema
export function profileCount(): number {
  if (!repoExists("profiles")) throw new Error("profiles/ is missing");
  return filesUnder(ROOT, "profiles").filter((p) => /^profiles\/[^/]+\.json$/.test(p) && p !== "profiles/schema.json").length;
}

// the sentences a page must contain, as they are printed. verify-dist.ts reads this list and fails the build when a
// page lacks one, so a figure is checked in the rendered page and not only where it is read
export const PAGE_FIGURES: { page: string; text: () => string; why: string }[] = [
  { page: "/accessibility/", text: () => figure("ledCeilingMa"), why: "the LED current ceiling" },
  { page: "/how-it-works/", text: () => `${fact("bpmMin")} to ${figure("bpmMax")}`, why: "the Rhythm tempo range" },
  { page: "/hardware/", text: () => figure("ledCeilingMa"), why: "the firmware's LED current ceiling, the one power figure the page states" },
  { page: "/accessibility/", text: () => `${fact("speedMinPercent")} to ${figure("speedMaxPercent")}`, why: "the Studio speed range" },
  { page: "/accessibility/", text: () => `${figure("midiMaxMiB")}, ${figure("midiMaxTracks")}, ${figure("midiMaxNotes")} and ${figure("midiMaxHours")}`, why: "the MIDI import limits" },
];
