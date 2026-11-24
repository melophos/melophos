// the numbers behind the progress view. every function is pure so it is tested without a screen.
// nothing here counts a streak: a record of days practised carries the same fact without the pressure.
import type { SessionRecord } from "./store";

export interface Day {
  // local date as year-month-day
  date: string;
  practised: boolean;
  sessions: number;
  minutes: number;
}

const two = (n: number): string => String(n).padStart(2, "0");
export const localDate = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

// the last N days ending today, oldest first
export function daysPractised(records: readonly SessionRecord[], today: Date, windowDays = 28): Day[] {
  const byDay = new Map<string, { sessions: number; ms: number }>();
  for (const r of records) {
    const key = localDate(new Date(r.startedAt));
    const have = byDay.get(key) ?? { sessions: 0, ms: 0 };
    byDay.set(key, { sessions: have.sessions + 1, ms: have.ms + r.durationMs });
  }
  const days: Day[] = [];
  for (let back = windowDays - 1; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = localDate(d);
    const have = byDay.get(key);
    days.push({ date: key, practised: Boolean(have), sessions: have?.sessions ?? 0, minutes: have ? Math.max(1, Math.round(have.ms / 60000)) : 0 });
  }
  return days;
}

export const practisedCount = (days: readonly Day[]): number => days.filter((d) => d.practised).length;

export interface Point {
  // 1 for the oldest session of the piece
  session: number;
  startedAt: string;
  // per cent, 0 to 100
  firstTimePct: number;
  firstTime: number;
  total: number;
  speedPct: number;
  accuracyPct: number | null;
  mode: SessionRecord["mode"];
}

// the sessions of one piece in time order
export function seriesFor(records: readonly SessionRecord[], pieceId: string): Point[] {
  return records
    .filter((r) => r.pieceId === pieceId && r.mode !== "listen")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((r, i) => ({
      session: i + 1,
      startedAt: r.startedAt,
      firstTimePct: r.total > 0 ? Math.round((r.firstTime / r.total) * 1000) / 10 : 0,
      firstTime: r.firstTime,
      total: r.total,
      speedPct: r.speedPct,
      accuracyPct: r.score ? Math.round(r.score.accuracy * 1000) / 10 : null,
      mode: r.mode,
    }));
}

// the keys missed most, over every session or one piece
export function mergeMissed(records: readonly SessionRecord[], pieceId?: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of records) {
    if (pieceId && r.pieceId !== pieceId) continue;
    for (const m of r.missed) out.set(m.note, (out.get(m.note) ?? 0) + m.count);
  }
  return out;
}

// five steps for the heat scale. a count of 0 is no step, so an untouched key is plain
export function heatStep(count: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5))) as 1 | 2 | 3 | 4 | 5;
}

// the pieces that have any practice, newest first
export function practisedPieces(records: readonly SessionRecord[]): { pieceId: string; title: string; sessions: number; last: string }[] {
  const map = new Map<string, { pieceId: string; title: string; sessions: number; last: string }>();
  for (const r of records) {
    if (r.mode === "listen") continue;
    const have = map.get(r.pieceId);
    if (!have) map.set(r.pieceId, { pieceId: r.pieceId, title: r.pieceTitle, sessions: 1, last: r.startedAt });
    else map.set(r.pieceId, { ...have, sessions: have.sessions + 1, last: r.startedAt > have.last ? r.startedAt : have.last });
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

// a sentence of counts, with a plain note when there is too little to say more
export function recordSentence(days: readonly Day[]): string {
  const n = practisedCount(days);
  if (n === 0) return `You have not practised in the last ${days.length} days.`;
  return `You practised on ${n} of the last ${days.length} days.`;
}

export const ENOUGH_FOR_A_LINE = 2;
