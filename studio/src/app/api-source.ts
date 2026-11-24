// reads practice sessions from the player's own MELOPHOS server (GET /api/v1/sessions), read only. the Studio never needs
// this: everything works from the browser's own record. it is here so the progress view can chart sessions the hub
// stored. every number that comes back is checked, the call has a time limit and the number of pages is bounded.
import { TIMED_OUT, isTimeout, limits, readJson } from "./net";

export interface ServerSession {
  id: string;
  startedAt: string;
  songId: string | null;
  mode: string | null;
  durationMs: number;
  notesPlayed: number;
  // 0 to 1 or null when the server has not scored the session
  accuracy: number | null;
  // per cent of the written speed or null
  speedPct: number | null;
  // scoring happens after the session is saved, so a score can be pending, scored, failed or absent
  scoreState: "none" | "pending" | "scored" | "failed";
}

export type SourceResult = { ok: true; sessions: ServerSession[]; truncated: boolean } | { ok: false; reason: string };

export const PAGE_LIMIT = 200;
export const MAX_PAGES = 10;

// only an address that the browser will let a secure page call: https anywhere or http on this machine
export function checkBase(input: string): { ok: true; base: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "That is not a web address. It should look like https://melophos.example.net" };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { ok: false, reason: "Use an address that starts with https. A plain http address only works on this machine." };
  }
  if (url.username || url.password) return { ok: false, reason: "Leave the user name and password out of the address." };
  return { ok: true, base: `${url.origin}` };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseSession(raw: unknown): ServerSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const summary = (r["summary"] ?? {}) as Record<string, unknown>;
  const startedAt = typeof r["started_at"] === "string" ? r["started_at"] : "";
  if (typeof r["id"] !== "string" || Number.isNaN(Date.parse(startedAt))) return null;
  const state = (["none", "pending", "scored", "failed"] as const).find((x) => x === r["score_state"]) ?? "none";
  // a number is only shown once the server says it has arrived
  const accuracy = state === "scored" ? num(r["accuracy"]) : null;
  const speed = num(r["final_speed_ppm"]);
  return {
    id: r["id"],
    startedAt,
    songId: typeof r["song_id"] === "string" ? r["song_id"] : null,
    mode: typeof r["mode"] === "string" ? r["mode"] : null,
    durationMs: Math.max(0, num(summary["duration_ms"]) ?? 0),
    notesPlayed: Math.max(0, num(summary["notes_played"]) ?? 0),
    accuracy: accuracy !== null && accuracy >= 0 && accuracy <= 1 ? accuracy : null,
    scoreState: state,
    speedPct: state === "scored" && speed !== null && speed > 0 && speed < 10_000_000 ? Math.round(speed / 10_000) : null,
  };
}

export async function readServerSessions(baseInput: string, token: string | null, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
  const checked = checkBase(baseInput);
  if (!checked.ok) return checked;
  const sessions: ServerSession[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL("/api/v1/sessions", checked.base);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(limits.timeoutMs), headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "omit" });
    } catch (error) {
      return { ok: false, reason: isTimeout(error) ? TIMED_OUT : "The server could not be reached. Check the address and that it allows this page to call it." };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "The server asked for a sign-in. Paste a valid token and try again." };
    if (!response.ok) return { ok: false, reason: `The server answered with an error (${response.status}).` };
    const read = await readJson<unknown>(response);
    if (!read.ok) return read;
    const body = read.value;
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items)) return { ok: false, reason: "The server's answer has no list of sessions." };
    for (const item of items.slice(0, Math.min(PAGE_LIMIT, limits.maxRows))) {
      const s = parseSession(item);
      if (s) sessions.push(s);
    }
    const next = (body as { next_cursor?: unknown }).next_cursor;
    if (typeof next !== "string" || next.length === 0) return { ok: true, sessions, truncated: false };
    cursor = next;
  }
  return { ok: true, sessions, truncated: true };
}
