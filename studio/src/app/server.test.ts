import { describe, expect, it } from "vitest";

import { diffHands, getSong, normaliseCode, pairHub, putHands, resetHands, signIn, songNotes, uploadSong, type Link } from "./server";

const link: Link = { base: "https://own.example", token: "tok" };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const song = (over: Record<string, unknown> = {}) => ({ id: "abc", title: "T", import_state: "ready", note_count: 3, hands_method: "pitch", hands_edited: false, import_error: null, ...over });

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: string | null;
}
function recorder(replies: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = ((url: URL, init: RequestInit) => {
    calls.push({ url: String(url), method: String(init.method), auth: new Headers(init.headers).get("authorization"), body: typeof init.body === "string" ? init.body : init.body ? "(bytes)" : null });
    return Promise.resolve(replies.shift() ?? json({}, 500));
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe("pairing", () => {
  it("sends the code as the documented body with the account token", async () => {
    const { fetch, calls } = recorder([json({ id: "dev-1", name: "Hub" })]);
    const r = await pairHub(link, "abcd efgh", " Piano hub ", fetch);
    expect(r).toEqual({ ok: true, value: { id: "dev-1", name: "Hub" } });
    expect(calls[0]).toMatchObject({ url: "https://own.example/api/v1/devices/pair", method: "POST", auth: "Bearer tok" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ code: "ABCDEFGH", name: "Piano hub" });
  });

  it("explains a wrong code, a full account and a limit", async () => {
    expect(await pairHub(link, "ABCDEFGH", null, recorder([json({ detail: "x" }, 404)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/wrong or has expired/) });
    expect(await pairHub(link, "ABCDEFGH", null, recorder([json({}, 409)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/most hubs/) });
    expect(await pairHub(link, "ABCDEFGH", null, recorder([json({}, 429)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/waiting from this network/) });
    expect(await pairHub(link, "ab", null, recorder([]).fetch)).toMatchObject({ ok: false });
  });

  it("tidies a typed code", () => {
    expect(normaliseCode(" ab-cd ef\tgh ")).toBe("ABCDEFGH");
  });
});

describe("signing in", () => {
  it("returns the token and says so plainly when the server refuses", async () => {
    expect(await signIn(link, "a@b.example", "pw", recorder([json({ token: "t1", expires_at: "x", user: {} })]).fetch)).toEqual({ ok: true, value: "t1" });
    expect(await signIn(link, "a@b.example", "pw", recorder([json({}, 401)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/email and password/) });
  });

  it("does not send an old token when signing in", async () => {
    const { fetch, calls } = recorder([json({ token: "t" })]);
    await signIn(link, "a@b.example", "pw", fetch);
    expect(calls[0]?.auth).toBeNull();
  });
});

describe("songs and hands", () => {
  it("uploads the file as audio/midi with a title", async () => {
    const { fetch, calls } = recorder([json(song({ import_state: "queued" }), 202)]);
    const r = await uploadSong(link, "My tune", new Uint8Array([1]), fetch);
    expect(r).toMatchObject({ ok: true, value: { id: "abc", importState: "queued" } });
    expect(calls[0]?.url).toBe("https://own.example/api/v1/songs?title=My+tune");
  });

  it("reads every page of notes within a bound", async () => {
    const { fetch, calls } = recorder([
      json({ items: [{ idx: 0, note: 60, hand: "right", t_ms: 0, dur_ms: 1, velocity: 1 }], next_after: 0 }),
      json({ items: [{ idx: 1, note: 48, hand: "left" }], next_after: null }),
    ]);
    const r = await songNotes(link, "abc", fetch);
    expect(r).toEqual({ ok: true, value: [{ idx: 0, note: 60, hand: "right" }, { idx: 1, note: 48, hand: "left" }] });
    expect(calls[1]?.url).toContain("after=0");
    expect(await songNotes(link, "abc", recorder([json({ items: [{ idx: 0, note: 60, hand: "middle" }], next_after: null })]).fetch)).toMatchObject({ ok: false });
  });

  it("puts only the changes in the documented body", async () => {
    const { fetch, calls } = recorder([json(song({ hands_edited: true }))]);
    const r = await putHands(link, "abc", [{ idx: 2, hand: "left" }], fetch);
    expect(r).toMatchObject({ ok: true, value: { handsEdited: true } });
    expect(calls[0]).toMatchObject({ method: "PUT", url: "https://own.example/api/v1/songs/abc/hands" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ changes: [{ idx: 2, hand: "left" }] });
  });

  it("says when the server has not finished reading the song", async () => {
    expect(await putHands(link, "abc", [{ idx: 1, hand: "left" }], recorder([json({ detail: "not finished" }, 409)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/not finished reading/) });
  });

  it("explains a refused PUT when the browser blocks it before it leaves", async () => {
    const blocked = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    expect(await putHands(link, "abc", [{ idx: 1, hand: "left" }], blocked)).toMatchObject({ ok: false, reason: expect.stringMatching(/PUT call needs the server's allowed methods/) });
  });

  it("resets to the importer's split and reads one song", async () => {
    const { fetch, calls } = recorder([json(song()), json(song({ import_state: "failed", import_error: "no notes" }))]);
    expect(await resetHands(link, "abc", fetch)).toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://own.example/api/v1/songs/abc/hands/reset" });
    expect(await getSong(link, "abc", fetch)).toMatchObject({ ok: true, value: { importState: "failed", importError: "no notes" } });
  });

  it("refuses a bad address before any call", async () => {
    expect(await getSong({ base: "http://192.168.1.4:8000", token: "t" }, "abc", recorder([]).fetch)).toMatchObject({ ok: false });
  });
});

describe("what to send", () => {
  const server = [{ idx: 0, note: 60, hand: "right" as const }, { idx: 1, note: 48, hand: "left" as const }, { idx: 2, note: 50, hand: "left" as const }];

  it("lists only the notes whose hand differs", () => {
    expect(diffHands(server, [{ note: 60, hand: "right" }, { note: 48, hand: "left" }, { note: 50, hand: "right" }])).toEqual({ ok: true, changes: [{ idx: 2, hand: "right" }] });
    expect(diffHands(server, server)).toEqual({ ok: true, changes: [] });
  });

  it("refuses when the notes are not the same reading of the file", () => {
    expect(diffHands(server, [{ note: 60, hand: "right" }])).toMatchObject({ ok: false });
    expect(diffHands(server, [{ note: 60, hand: "right" }, { note: 49, hand: "left" }, { note: 50, hand: "left" }])).toMatchObject({ ok: false, reason: expect.stringMatching(/Note 2/) });
  });
});

import { accountUsage, usageSentence, deleteAccount, deleteSession, listDevices, removeDevice, signOutEverywhere } from "./server";

describe("taking data away", () => {
  const empty = (status = 204): Response => new Response(null, { status });

  it("deletes one session, signs out everywhere and removes a hub with the documented calls", async () => {
    const { fetch, calls } = recorder([empty(), empty(), empty()]);
    expect(await deleteSession(link, "s 1", fetch)).toEqual({ ok: true, value: null });
    expect(await signOutEverywhere(link, fetch)).toEqual({ ok: true, value: null });
    expect(await removeDevice(link, "dev-1", fetch)).toEqual({ ok: true, value: null });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["DELETE /api/v1/sessions/s%201", "POST /api/v1/auth/signout-everywhere", "DELETE /api/v1/devices/dev-1"]);
  });

  it("deletes the account only with the password in the body and says so when it is wrong", async () => {
    const { fetch, calls } = recorder([empty()]);
    expect(await deleteAccount(link, "pw", fetch)).toEqual({ ok: true, value: null });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://own.example/api/v1/auth/account" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ password: "pw" });
    expect(await deleteAccount(link, "", recorder([]).fetch)).toMatchObject({ ok: false });
    expect(await deleteAccount(link, "x", recorder([json({}, 401)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/Nothing was deleted/) });
  });

  it("lists the hubs on the account", async () => {
    expect(await listDevices(link, recorder([json([{ id: "d1", name: "Hub", paired_at: "2026-11-01T10:00:00Z" }, { nope: 1 }])]).fetch)).toEqual({ ok: true, value: [{ id: "d1", name: "Hub", pairedAt: "2026-11-01T10:00:00Z" }] });
  });
});

describe("what the server says about itself", () => {
  it("says the server is busy when sign-in answers 503", async () => {
    expect(await signIn(link, "a@b.example", "pw", recorder([json({}, 503)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/busy, try again in a moment/) });
  });

  it("explains a pairing limit from one network", async () => {
    expect(await pairHub(link, "ABCDEFGH", null, recorder([json({}, 429)]).fetch)).toMatchObject({ ok: false, reason: expect.stringMatching(/waiting from this network/) });
  });

  it("shows the storage used and says plainly when recording has stopped", async () => {
    const used = await accountUsage(link, recorder([json({ events_used: 10, events_limit: 100, storage_full: false })]).fetch);
    expect(used.ok && usageSentence(used.value)).toBe("10 of 100 note events are used on your server.");
    const full = await accountUsage(link, recorder([json({ events_used: 100, events_limit: 100, storage_full: true })]).fetch);
    expect(full.ok && usageSentence(full.value)).toMatch(/storage is full.*not being recorded/);
    expect(await accountUsage(link, recorder([json({})]).fetch)).toMatchObject({ ok: false });
  });
});
