// the rhythm game. it adds no scoring of its own. a result is the figures the scoring engine gave for the run and a personal
// best is the highest of those engine accuracies for the same song and the same difficulty. nothing here counts points,
// levels, stars or streaks.
import type { SessionRecord } from "./app/store";
import type { HandChoice } from "./piece";

// what the player chooses to make it easier or harder. none of these changes how strictly a note is judged
export interface Difficulty {
  hand: HandChoice;
  // the speed as a percentage of the written tempo, 25 to 125
  speedPct: number;
  // a range of bars or null for the whole piece
  fromBar: number | null;
  toBar: number | null;
}

// each figure is a field of the engine's summary. see the README for the mapping
export interface GameResult {
  // the engine's playedAccuracy: hits over the notes in the hands played plus wrong presses, from 0 to 1
  accuracy: number;
  // hits
  hits: number;
  // late
  late: number;
  // misses
  misses: number;
  // wrong
  wrong: number;
  // playedExpected
  expected: number;
  // presses the engine was not sure about, which count neither for nor against the player
  notJudged: number;
}

export interface Best extends GameResult {
  id: string;
  songId: string;
  songTitle: string;
  // the settings it was set with, kept so it is shown with them
  difficulty: Difficulty;
  // the build of the scoring engine that judged it
  engine: string;
  achievedAt: string;
}

export const difficultyKey = (songId: string, d: Difficulty): string => `${songId}|${d.hand}|${d.speedPct}|${d.fromBar ?? 0}-${d.toBar ?? 0}`;
export const bestId = (songId: string, d: Difficulty, engine: string): string => `${difficultyKey(songId, d)}|${engine}`;

// turns the run's record into a result. the record's score was made from the engine's summary
export function resultFrom(record: SessionRecord): GameResult | null {
  const s = record.score;
  if (!s) return null;
  return { accuracy: s.accuracy, hits: s.hits, late: s.late ?? 0, misses: s.misses, wrong: s.wrong, expected: s.expected, notJudged: s.notJudged ?? 0 };
}

export type Outcome = { kind: "first" } | { kind: "new-best"; previous: Best } | { kind: "not-best"; best: Best };

// a result is compared only with a best for the same song and difficulty from the same engine build
export function judge(bests: readonly Best[], songId: string, d: Difficulty, result: GameResult, engine: string): Outcome {
  const id = bestId(songId, d, engine);
  const have = bests.find((b) => b.id === id);
  if (!have) return { kind: "first" };
  return result.accuracy > have.accuracy ? { kind: "new-best", previous: have } : { kind: "not-best", best: have };
}

export function makeBest(record: SessionRecord, d: Difficulty, result: GameResult, engine: string): Best {
  return { id: bestId(record.pieceId, d, engine), songId: record.pieceId, songTitle: record.pieceTitle, difficulty: d, engine, achievedAt: record.startedAt, ...result };
}

// bests from this build of the engine and bests from earlier builds that are kept and not compared
export function groupBests(bests: readonly Best[], engine: string): { current: Best[]; earlier: Best[] } {
  return { current: bests.filter((b) => b.engine === engine), earlier: bests.filter((b) => b.engine !== engine) };
}

export function describeDifficulty(d: Difficulty): string {
  const hands = d.hand === "both" ? "both hands" : `${d.hand} hand`;
  const bars = d.fromBar === null && d.toBar === null ? "the whole piece" : `bars ${d.fromBar ?? 1} to ${d.toBar ?? "the end"}`;
  return `${d.speedPct}% speed, ${hands}, ${bars}`;
}

export const percent = (accuracy: number): string => `${(Math.round(accuracy * 1000) / 10).toFixed(1)}%`;

// the whole piece is the same difficulty however it is written: bars 1 to the last bar and no range at all are one and the same
export function normaliseRange(fromBar: number | null, toBar: number | null, bars: number): { fromBar: number | null; toBar: number | null } {
  const from = fromBar ?? 1;
  const to = toBar ?? bars;
  return from <= 1 && to >= bars ? { fromBar: null, toBar: null } : { fromBar: from, toBar: to };
}
