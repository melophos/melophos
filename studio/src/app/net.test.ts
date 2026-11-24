import { afterEach, describe, expect, it } from "vitest";

import { readServerSessions } from "./api-source";
import { limits, readJson } from "./net";
import { check, listDevices } from "./server";

const link = { base: "https://own.example", token: "t" };
const original = { ...limits };
afterEach(() => Object.assign(limits, original));

// a fetch that never answers on its own but gives up when its signal says so, as a real one does
const hangs = ((_url: URL, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

// a body that sends a little and then stalls until it is told to stop
function trickle(signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"items":['));
      signal.addEventListener("abort", () => c.error(signal.reason));
    },
  });
  return new Response(stream);
}

describe("an answer from a server nobody vouches for", () => {
  it("is read as a stream and dropped as soon as it passes the cap", async () => {
    limits.maxBodyBytes = 1000;
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 400;
        c.enqueue(new Uint8Array(400).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    const r = await readJson(new Response(stream));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/bigger than the Studio will read/) });
    expect(cancelled).toBe(true);
    // it stopped reading at once instead of taking a whole huge answer into memory
    expect(sent).toBeLessThan(5000);
  });

  it("is refused unread when it says it is too big", async () => {
    limits.maxBodyBytes = 1000;
    const r = await readJson(new Response("{}", { headers: { "content-length": "999999999" } }));
    expect(r).toMatchObject({ ok: false });
  });

  it("is cut to a number of rows", async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `d${i}`, name: "x".repeat(100) }));
    const r = await listDevices(link, (() => Promise.resolve(new Response(JSON.stringify(many)))) as unknown as typeof fetch);
    expect(r.ok && r.value).toHaveLength(200);
    expect(r.ok && r.value[0]?.name.length).toBe(60);
  });
});

describe("every call has a time limit", () => {
  it("gives up on a server that never answers", async () => {
    limits.timeoutMs = 40;
    const began = Date.now();
    const r = await check(link, hangs);
    expect(r).toMatchObject({ ok: false, reason: "The server did not answer within 10 seconds." });
    expect(Date.now() - began).toBeLessThan(2000);
  });

  it("gives up on an answer that starts and never ends and says so", async () => {
    limits.timeoutMs = 40;
    const f = ((_u: URL, init: RequestInit) => Promise.resolve(trickle(init.signal as AbortSignal))) as unknown as typeof fetch;
    expect(await check(link, f)).toMatchObject({ ok: false, reason: "The server did not answer within 10 seconds." });
  });

  it("applies to reading sessions as well", async () => {
    limits.timeoutMs = 40;
    expect(await readServerSessions("https://own.example", "t", hangs)).toMatchObject({ ok: false, reason: "The server did not answer within 10 seconds." });
  });
});
