// the optional link to the player's own MELOPHOS server. everything here is read from the server's API document
// (server/README.md and docs/protocol.md). the Studio works the same with no server at all: none of this runs unless the
// player has put the server's address in Settings and every call is made only when a button is pressed.
// every call has a time limit, every answer is checked and every failure is a sentence a person can act on.
import { checkBase } from "./api-source";
import { TIMED_OUT, isTimeout, limits, readJson } from "./net";
import type { Hand } from "../songs";

export const NOTE_PAGE = 2000;
export const MAX_NOTE_PAGES = 30;
export const MAX_CHANGES = 50_000;

export interface Link {
  base: string;
  // an account token from the server's own sign-in. kept in memory only
  token: string | null;
}

export type Reply<T> = { ok: true; value: T } | { ok: false; reason: string; status: number | null };

const REASON: Record<number, string> = {
  401: "The server wants you to sign in again.",
  403: "The server did not allow that.",
  404: "The server does not have that.",
  409: "The server cannot do that now.",
  413: "The file is larger than the server accepts.",
  415: "The server does not accept that kind of file.",
  422: "The server refused what was sent.",
  429: "The server says there have been too many tries. Wait a few minutes and try again.",
  503: "The server is busy, try again in a moment.",
};

async function call<T>(link: Link, method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string>; query?: Record<string, string> } = {}, fetchImpl: typeof fetch = fetch): Promise<Reply<T>> {
  const checked = checkBase(link.base);
  if (!checked.ok) return { ok: false, reason: checked.reason, status: null };
  const url = new URL(path, checked.base);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...init.headers };
  if (link.token) headers["Authorization"] = `Bearer ${link.token}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { method, headers, ...(init.body !== undefined ? { body: init.body } : {}), signal: AbortSignal.timeout(limits.timeoutMs), credentials: "omit" });
  } catch (error) {
    if (isTimeout(error)) return { ok: false, reason: TIMED_OUT, status: null };
    const hint = method === "PUT" || method === "DELETE" ? `. A ${method} call needs the server's allowed methods to include it` : "";
    return { ok: false, status: null, reason: `The server could not be reached. Check the address and that your server lets this page call it${hint}.` };
  }
  if (!response.ok) {
    let detail = "";
    const body = await readJson<{ detail?: unknown }>(response);
    if (body.ok && typeof body.value.detail === "string") detail = body.value.detail.slice(0, 200);
    const base = REASON[response.status] ?? `The server answered with an error (${response.status}).`;
    return { ok: false, status: response.status, reason: detail ? `${base} It said: ${detail}` : base };
  }
  // a delete answers 204 with no body
  if (response.status === 204) return { ok: true, value: null as T };
  const body = await readJson<T>(response);
  return body.ok ? { ok: true, value: body.value } : { ok: false, reason: body.reason, status: response.status };
}

export async function check(link: Link, fetchImpl?: typeof fetch): Promise<Reply<{ status: string }>> {
  return call(link, "GET", "/health", {}, fetchImpl);
}

export async function signIn(link: Link, email: string, password: string, fetchImpl?: typeof fetch): Promise<Reply<string>> {
  const r = await call<{ token?: unknown }>({ ...link, token: null }, "POST", "/api/v1/auth/signin", { body: JSON.stringify({ email: email.trim(), password }), headers: { "Content-Type": "application/json" } }, fetchImpl);
  if (!r.ok) return r.status === 401 ? { ...r, reason: "The server did not accept that email and password." } : r;
  return typeof r.value.token === "string" && r.value.token.length > 0 ? { ok: true, value: r.value.token } : { ok: false, reason: "The server answered with no token.", status: 200 };
}

// the code on the hub: 8 characters, typed with or without spaces or hyphens
export function normaliseCode(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

export interface Device {
  id: string;
  name: string;
}

export async function pairHub(link: Link, code: string, name: string | null, fetchImpl?: typeof fetch): Promise<Reply<Device>> {
  const clean = normaliseCode(code);
  if (clean.length < 4 || clean.length > 32) return { ok: false, status: null, reason: "Type the code the hub is showing. It has 8 characters." };
  const label = name?.trim();
  const body: { code: string; name?: string } = { code: clean };
  if (label) body.name = label.slice(0, 60);
  const r = await call<{ id?: unknown; name?: unknown }>(link, "POST", "/api/v1/devices/pair", { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, fetchImpl);
  if (!r.ok) {
    if (r.status === 404) return { ...r, reason: "That code is wrong or has expired. A code lasts 10 minutes. Check the hub and try again." };
    if (r.status === 409) return { ...r, reason: "Your account already has the most hubs the server allows. Remove one first." };
    if (r.status === 429) return { ...r, reason: "Too many codes are waiting from this network or too many wrong ones were typed. Wait about ten minutes for them to expire and try again." };
    return r;
  }
  return typeof r.value.id === "string" ? { ok: true, value: { id: r.value.id, name: typeof r.value.name === "string" ? r.value.name : "Hub" } } : { ok: false, status: 200, reason: "The server answered with no hub." };
}

export interface ServerSong {
  id: string;
  title: string;
  importState: "queued" | "running" | "ready" | "failed";
  importError: string | null;
  noteCount: number | null;
  handsMethod: string | null;
  handsEdited: boolean;
}

function parseSong(v: unknown): ServerSong | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const state = (["queued", "running", "ready", "failed"] as const).find((s) => s === r["import_state"]);
  if (typeof r["id"] !== "string" || !state) return null;
  return {
    id: r["id"],
    title: typeof r["title"] === "string" ? r["title"] : "",
    importState: state,
    importError: typeof r["import_error"] === "string" ? r["import_error"] : null,
    noteCount: typeof r["note_count"] === "number" ? r["note_count"] : null,
    handsMethod: typeof r["hands_method"] === "string" ? r["hands_method"] : null,
    handsEdited: r["hands_edited"] === true,
  };
}

export async function uploadSong(link: Link, title: string, bytes: Uint8Array, fetchImpl?: typeof fetch): Promise<Reply<ServerSong>> {
  const r = await call<unknown>(link, "POST", "/api/v1/songs", { query: { title: title.slice(0, 120) }, body: bytes as BodyInit, headers: { "Content-Type": "audio/midi" } }, fetchImpl);
  if (!r.ok) return r;
  const song = parseSong(r.value);
  return song ? { ok: true, value: song } : { ok: false, status: 200, reason: "The server answered with something that is not a song." };
}

export async function getSong(link: Link, id: string, fetchImpl?: typeof fetch): Promise<Reply<ServerSong>> {
  const r = await call<unknown>(link, "GET", `/api/v1/songs/${encodeURIComponent(id)}`, {}, fetchImpl);
  if (!r.ok) return r;
  const song = parseSong(r.value);
  return song ? { ok: true, value: song } : { ok: false, status: 200, reason: "The server answered with something that is not a song." };
}

export interface ServerNote {
  idx: number;
  note: number;
  hand: Hand;
}

// every note of a song with its hand, page by page, within a bound
export async function songNotes(link: Link, id: string, fetchImpl?: typeof fetch): Promise<Reply<ServerNote[]>> {
  const out: ServerNote[] = [];
  let after = -1;
  for (let page = 0; page < MAX_NOTE_PAGES; page++) {
    const r = await call<{ items?: unknown; next_after?: unknown }>(link, "GET", `/api/v1/songs/${encodeURIComponent(id)}/notes`, { query: { limit: String(NOTE_PAGE), after: String(after) } }, fetchImpl);
    if (!r.ok) return r;
    if (!Array.isArray(r.value.items)) return { ok: false, status: 200, reason: "The server's answer has no list of notes.", };
    for (const item of (r.value.items as Record<string, unknown>[]).slice(0, NOTE_PAGE)) {
      if (typeof item["idx"] !== "number" || typeof item["note"] !== "number" || (item["hand"] !== "left" && item["hand"] !== "right")) return { ok: false, status: 200, reason: "The server sent a note the Studio cannot read." };
      out.push({ idx: item["idx"], note: item["note"], hand: item["hand"] });
    }
    const next = r.value.next_after;
    if (typeof next !== "number") return { ok: true, value: out };
    after = next;
  }
  return { ok: false, status: null, reason: "The song has more notes than the Studio will read from a server." };
}

export async function putHands(link: Link, id: string, changes: { idx: number; hand: Hand }[], fetchImpl?: typeof fetch): Promise<Reply<ServerSong>> {
  if (changes.length === 0) return { ok: false, status: null, reason: "There is nothing to send: your hands already match the server's." };
  if (changes.length > MAX_CHANGES) return { ok: false, status: null, reason: `That is more than the ${MAX_CHANGES} changes the server takes in one go.` };
  const r = await call<unknown>(link, "PUT", `/api/v1/songs/${encodeURIComponent(id)}/hands`, { body: JSON.stringify({ changes }), headers: { "Content-Type": "application/json" } }, fetchImpl);
  if (!r.ok) {
    if (r.status === 409) return { ...r, reason: "The server has not finished reading that song yet. Check on it and try again." };
    return r;
  }
  const song = parseSong(r.value);
  return song ? { ok: true, value: song } : { ok: false, status: 200, reason: "The server answered with something that is not a song." };
}

export async function resetHands(link: Link, id: string, fetchImpl?: typeof fetch): Promise<Reply<ServerSong>> {
  const r = await call<unknown>(link, "POST", `/api/v1/songs/${encodeURIComponent(id)}/hands/reset`, {}, fetchImpl);
  if (!r.ok) return r;
  const song = parseSong(r.value);
  return song ? { ok: true, value: song } : { ok: false, status: 200, reason: "The server answered with something that is not a song." };
}

// what has to change on the server to make its hands equal to the player's. it refuses when the two do not describe the
// same notes, since an index that points at a different note would move the wrong one
export function diffHands(server: readonly ServerNote[], local: readonly { note: number; hand: Hand }[]): { ok: true; changes: { idx: number; hand: Hand }[] } | { ok: false; reason: string } {
  if (server.length !== local.length) return { ok: false, reason: `The server holds ${server.length} notes and this piece has ${local.length}, so they are not the same reading of the file. Nothing was sent.` };
  const changes: { idx: number; hand: Hand }[] = [];
  const sorted = [...server].sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const l = local[i]!;
    if (s.idx !== i || s.note !== l.note) return { ok: false, reason: `Note ${i + 1} is not the same on the server and here, so they are not the same reading of the file. Nothing was sent.` };
    if (s.hand !== l.hand) changes.push({ idx: s.idx, hand: l.hand });
  }
  return { ok: true, changes };
}

// ---- taking data away. each of these is permanent on the server, so the interface asks first and says what goes

export async function deleteSession(link: Link, id: string, fetchImpl?: typeof fetch): Promise<Reply<null>> {
  return call<null>(link, "DELETE", `/api/v1/sessions/${encodeURIComponent(id)}`, {}, fetchImpl);
}

export async function signOutEverywhere(link: Link, fetchImpl?: typeof fetch): Promise<Reply<null>> {
  return call<null>(link, "POST", "/api/v1/auth/signout-everywhere", {}, fetchImpl);
}

// deletes the account with its devices, sessions, note events, songs, endpoints and sign-ins for good
export async function deleteAccount(link: Link, password: string, fetchImpl?: typeof fetch): Promise<Reply<null>> {
  if (!password) return { ok: false, status: null, reason: "Type your password to confirm." };
  const r = await call<null>(link, "DELETE", "/api/v1/auth/account", { body: JSON.stringify({ password }), headers: { "Content-Type": "application/json" } }, fetchImpl);
  if (!r.ok && r.status === 401) return { ...r, reason: "The server did not accept that password. Nothing was deleted." };
  return r;
}

export interface HubRow {
  id: string;
  name: string;
  pairedAt: string | null;
}

export async function listDevices(link: Link, fetchImpl?: typeof fetch): Promise<Reply<HubRow[]>> {
  const r = await call<unknown>(link, "GET", "/api/v1/devices", {}, fetchImpl);
  if (!r.ok) return r;
  if (!Array.isArray(r.value)) return { ok: false, status: 200, reason: "The server's answer has no list of hubs." };
  const rows: HubRow[] = [];
  for (const d of (r.value as Record<string, unknown>[]).slice(0, limits.maxRows)) if (typeof d["id"] === "string") rows.push({ id: d["id"], name: typeof d["name"] === "string" ? d["name"].slice(0, 60) : "Hub", pairedAt: typeof d["paired_at"] === "string" ? d["paired_at"] : null });
  return { ok: true, value: rows };
}

// takes a hub off the account. this is how an owner reverses a claim they did not expect: the hub and its sessions go
export async function removeDevice(link: Link, id: string, fetchImpl?: typeof fetch): Promise<Reply<null>> {
  return call<null>(link, "DELETE", `/api/v1/devices/${encodeURIComponent(id)}`, {}, fetchImpl);
}

export interface Usage {
  eventsUsed: number;
  eventsLimit: number;
  // recording has stopped because the account is at its limit
  storageFull: boolean;
}

export async function accountUsage(link: Link, fetchImpl?: typeof fetch): Promise<Reply<Usage>> {
  const r = await call<Record<string, unknown>>(link, "GET", "/api/v1/auth/me", {}, fetchImpl);
  if (!r.ok) return r;
  const used = r.value["events_used"];
  const limit = r.value["events_limit"];
  if (typeof used !== "number" || typeof limit !== "number") return { ok: false, status: 200, reason: "The server did not say how much storage is used." };
  return { ok: true, value: { eventsUsed: used, eventsLimit: limit, storageFull: r.value["storage_full"] === true } };
}

// the words for the account's storage
export function usageSentence(u: Usage): string {
  if (u.storageFull) return `Your server's storage is full (${u.eventsUsed} of ${u.eventsLimit} note events), so new practice sessions are not being recorded. Delete some sessions to make room.`;
  return `${u.eventsUsed} of ${u.eventsLimit} note events are used on your server.`;
}
