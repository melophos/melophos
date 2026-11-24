import { describe, expect, it } from "vitest";

import { MAX_PAGES, checkBase, parseSession, readServerSessions } from "./api-source";

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  started_at: "2026-11-01T10:00:00Z",
  song_id: "s1",
  mode: "rhythm",
  summary: { duration_ms: 60000, notes_played: 40 },
  accuracy: 0.9,
  final_speed_ppm: 800000,
  score_state: "scored",
  ...over,
});

const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe("server address", () => {
  it("allows https and http on this machine only", () => {
    expect(checkBase("https://melophos.example.net/x")).toEqual({ ok: true, base: "https://melophos.example.net" });
    expect(checkBase("http://localhost:8000")).toEqual({ ok: true, base: "http://localhost:8000" });
    expect(checkBase("http://192.168.1.10:8000")).toMatchObject({ ok: false });
    expect(checkBase("not a url")).toMatchObject({ ok: false });
    expect(checkBase("https://user:pw@host.example")).toMatchObject({ ok: false });
  });
});

describe("reading sessions", () => {
  it("maps the fields and the speed to a per cent", () => {
    expect(parseSession(item("a"))).toEqual({ id: "a", startedAt: "2026-11-01T10:00:00Z", songId: "s1", mode: "rhythm", durationMs: 60000, notesPlayed: 40, accuracy: 0.9, speedPct: 80, scoreState: "scored" });
  });

  it("shows no number until the score has arrived", () => {
    expect(parseSession(item("a", { score_state: "pending" }))).toMatchObject({ accuracy: null, speedPct: null, scoreState: "pending" });
    expect(parseSession(item("a", { score_state: "failed" }))).toMatchObject({ accuracy: null, scoreState: "failed" });
  });

  it("drops a record with no id or a bad date and a figure out of range", () => {
    expect(parseSession({ started_at: "2026-11-01T10:00:00Z" })).toBeNull();
    expect(parseSession(item("a", { started_at: "yesterday" }))).toBeNull();
    expect(parseSession(item("a", { accuracy: 4 }))?.accuracy).toBeNull();
  });

  it("follows the cursor to the last page", async () => {
    const pages = [reply({ items: [item("a")], next_cursor: "c1" }), reply({ items: [item("b")], next_cursor: null })];
    const calls: string[] = [];
    const result = await readServerSessions("https://h.example", "tok", ((u: URL) => (calls.push(String(u)), Promise.resolve(pages.shift()!))) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: true, truncated: false });
    expect(result.ok && result.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(calls[1]).toContain("cursor=c1");
  });

  it("stops after a bounded number of pages", async () => {
    let n = 0;
    const result = await readServerSessions("https://h.example", null, (() => Promise.resolve(reply({ items: [item(`x${n++}`)], next_cursor: "more" }))) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(n).toBe(MAX_PAGES);
  });

  it("explains a refusal, a failure and a bad body", async () => {
    expect(await readServerSessions("https://h.example", null, (() => Promise.resolve(reply({}, 401))) as unknown as typeof fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/sign-in/) });
    expect(await readServerSessions("https://h.example", null, (() => Promise.reject(new TypeError("net"))) as unknown as typeof fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be reached/) });
    expect(await readServerSessions("https://h.example", null, (() => Promise.resolve(reply({ nope: 1 }))) as unknown as typeof fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/no list/) });
    expect(await readServerSessions("https://h.example", null, (() => Promise.resolve(reply({}, 500))) as unknown as typeof fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/500/) });
  });
});
