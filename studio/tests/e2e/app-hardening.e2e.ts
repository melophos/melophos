// the token and the other server, a failed view, tabs and updates, the worker's
// behaviour in a real browser, speech, spoken wrong notes and the size of the keys
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { serveDist, serveOther } from "../lib/dist-server";

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await expect(page.locator("main h1")).toBeVisible();
}

// the Studio talks to a fake server on https://a.test and https://b.test and each records what it was sent
async function twoServers(page: Page): Promise<{ a: string[]; b: string[] }> {
  const seen = { a: [] as string[], b: [] as string[] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  for (const name of ["a", "b"] as const) {
    await page.route(`https://${name}.test/**`, async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const url = new URL(req.url());
      seen[name].push(`${req.method()} ${url.pathname} auth=${req.headers()["authorization"] ?? "none"}`);
      const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (url.pathname === "/api/v1/auth/signin") return json({ token: "TOKEN-FOR-A" });
      if (url.pathname === "/api/v1/devices") return json([{ id: "dev-1", name: "Hub", paired_at: null }]);
      if (url.pathname === "/api/v1/sessions") return json({ items: [{ id: "s1", started_at: "2026-11-01T10:00:00Z", summary: {}, score_state: "pending" }], next_cursor: null });
      if (url.pathname === "/api/v1/auth/me") return json({ events_used: 1, events_limit: 10, storage_full: false });
      return json({ status: "ok" });
    });
  }
  return seen;
}

test("the token of one server is never sent to the next address and what was read from the first is dropped", async ({ page }) => {
  const seen = await twoServers(page);
  await open(page, "/settings/server");
  await page.getByTestId("server-address").fill("https://a.test");
  await page.getByTestId("server-save").click();
  await page.getByLabel("Email").fill("me@example.net");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("server-message")).toContainText("Signed in");
  await page.getByRole("button", { name: "Read my sessions from the server" }).click();
  await expect(page.getByTestId("server-message")).toContainText("Read 1 sessions");
  expect(seen.a.some((r) => r.includes("auth=Bearer TOKEN-FOR-A"))).toBe(true);

  // the player changes the address to another server and goes straight to a page that calls it by itself
  await page.getByTestId("server-address").fill("https://b.test");
  await page.getByTestId("server-save").click();
  await page.getByRole("button", { name: "Check the server" }).click();
  await expect(page.getByTestId("server-message")).toContainText("The server answered");
  await open(page, "/devices");
  await open(page, "/progress");
  await page.waitForTimeout(300);
  expect(seen.b.length).toBeGreaterThan(0);
  expect(seen.b.filter((r) => !r.endsWith("auth=none")), "the second server saw a token").toEqual([]);
  // the page asks to sign in again and shows nothing read from the first server
  await open(page, "/settings/server");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await open(page, "/progress");
  await expect(page.getByTestId("server-progress")).toHaveCount(0);
});

test("a page that fails to load leaves the header and gives a way on", async ({ page }) => {
  await page.route(/\/assets\/Settings-.*\.js/, (route) => route.abort());
  await page.goto("/#/");
  await expect(page.locator("main h1")).toBeVisible();
  await page.evaluate(() => (location.hash = "#/settings/display"));
  await expect(page.getByTestId("view-failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload the Studio" })).toBeVisible();
  // the rest of the app is still there
  await expect(page.getByRole("link", { name: "Library" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Library" }).first().click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
});

test("another tab is never reloaded in the middle of a piece", async ({ context }) => {
  const site = await serveDist();
  try {
    const a = await context.newPage();
    await a.goto(`${site.url}/`);
    await expect(a.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
    await a.reload();
    await expect.poll(() => a.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const b = await context.newPage();
    await b.goto(`${site.url}/`);
    await expect.poll(() => b.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    site.newBuild();
    await a.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(a.getByTestId("update-banner")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByTestId("update-banner")).toBeVisible({ timeout: 15_000 });
    // tab A is part way through a piece. tab B may not update
    await a.goto(`${site.url}/#/practise/twinkle?mode=listen`);
    await expect(a.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
    await a.getByTestId("play").click();
    await expect(a.getByTestId("state-word")).toHaveText(/Count-in|Playing/);
    await expect(b.getByTestId("update-banner").getByRole("button")).toBeDisabled();
    await expect(b.getByTestId("update-banner")).toContainText("Another tab of the Studio has a piece running");
    // the piece is paused: now it can
    await a.getByTestId("play").click();
    await expect(b.getByTestId("update-banner").getByRole("button")).toBeEnabled();
  } finally {
    await site.close();
  }
});

test("the service worker never touches a request to another origin and never caches a signed-in answer", async ({ page }) => {
  const site = await serveDist();
  const other = await serveOther();
  try {
    await page.goto(`${site.url}/`);
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const ask = () => page.evaluate(async (u) => (await fetch(`${u}/manifest.webmanifest`, { headers: { Authorization: "Bearer SECRET" } })).json(), other.url);
    await ask();
    await ask();
    // the path is one the worker has cached for the app itself, so a worker that let another origin through to its cache would
    // answer from there. every request went to the network instead, none was answered from a cache and nothing of it was stored
    expect(other.hits()).toHaveLength(2);
    const stored = await page.evaluate(async (u) => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
      return urls.filter((x) => x.startsWith(u));
    }, other.url);
    expect(stored).toEqual([]);
    // a new build waits. nothing takes over without being asked
    site.newBuild();
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(page.getByTestId("update-banner")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => ({ waiting: r?.waiting !== null, activeUrl: r?.active?.scriptURL })))).toMatchObject({ waiting: true });
  } finally {
    await site.close();
    await other.close();
  }
});

test("the keys are big enough to press: white keys 44 px or more, black keys with the widest hit area the shape allows", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/practise/twinkle");
    const m = await page.evaluate(() => {
      const w = document.querySelector<SVGGElement>(".key-white .body")!.getBoundingClientRect();
      const b = document.querySelector<SVGGElement>(".key-black .body")!.getBoundingClientRect();
      const h = document.querySelector<SVGRectElement>(".key-black .hit")!.getBoundingClientRect();
      return { whiteW: w.width, whiteH: w.height, blackW: b.width, hitW: h.width, hitH: h.height };
    });
    expect(m.whiteW, `${width}px: white key width`).toBeGreaterThanOrEqual(43.9);
    expect(m.hitH, `${width}px: black key hit height`).toBeGreaterThanOrEqual(44);
    expect(m.hitW, `${width}px: black key hit width`).toBeGreaterThan(m.blackW);
    // the recorded figure: 0.72 of a white key, about 31.7 px at the smallest size
    expect(m.hitW).toBeGreaterThanOrEqual(31.5);
  }
});

test("a black key is played where its hit area reaches beyond what is drawn", async ({ page }) => {
  await open(page, "/practise/twinkle");
  await page.getByTestId("play").click();
  const body = await page.locator(".key[data-note='61'] .body").boundingBox();
  const hit = await page.locator(".key[data-note='61'] .hit").boundingBox();
  // a press just outside the drawn key and inside the hit area is that black key
  const x = body!.x - (hit!.width - body!.width) / 4;
  await page.mouse.move(x, body!.y + 10);
  await page.mouse.down();
  await expect(page.locator(".key[data-note='61']")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
});

test("a wrong note is announced once with the note still expected and spoken names use a local voice only", async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: { text: string; voice: string }[] = [];
    const voicesFor = (window as unknown as { __voices?: { name: string; lang: string; localService: boolean }[] });
    voicesFor.__voices = [{ name: "Cloud voice", lang: "en-GB", localService: false }];
    class Utterance {
      voice: unknown = null;
      lang = "";
      constructor(public text: string) {}
    }
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = Utterance;
    const synth = {
      getVoices: () => voicesFor.__voices,
      speak: (u: { text: string; voice: { name: string } }) => spoken.push({ text: u.text, voice: u.voice.name }),
      cancel: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    (window as unknown as { __spoken: typeof spoken }).__spoken = spoken;
  });
  await open(page, "/settings/sound");
  await page.getByText("Speak the next note").click();
  await expect(page.getByTestId("voice-status")).toContainText("no voice that runs on this device, so nothing will be spoken");
  await open(page, "/practise/twinkle");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.getByTestId("play").click();
  await page.keyboard.press("KeyK");
  await expect(page.getByTestId("announcer")).toHaveText("Wrong. Still C 4.");
  expect(await page.evaluate(() => (window as unknown as { __spoken: unknown[] }).__spoken)).toEqual([]);
  // with a local voice the next note is spoken
  await page.evaluate(() => ((window as unknown as { __voices: unknown[] }).__voices = [{ name: "Local voice", lang: "en-GB", localService: true }]));
  await page.keyboard.press("KeyA");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: { voice: string }[] }).__spoken.map((s) => s.voice))).toContain("Local voice");
});

test("spoken note names are offered plainly at first run and the offer goes once it is answered", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByTestId("speech-offer")).toContainText("never an online voice unless you allow one");
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("speech-offer")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("speech-offer")).toHaveCount(0);
});

test("the built app ships a headers file with the policy as a real header, the worker's policy and frame-ancestors", async () => {
  const headers = readFileSync("dist/_headers", "utf8");
  const html = readFileSync("dist/index.html", "utf8");
  expect(headers).toContain("frame-ancestors 'none'");
  expect(headers).toMatch(/\/sw\.js\n\s+Content-Security-Policy: default-src 'none'; connect-src 'self'/);
  // the page's own policy is the header's policy, so the two cannot drift
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!.replaceAll("&#39;", "'");
  expect(headers).toContain(meta);
});

test("the specimen page has a policy and breaks none of it", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => ((window as unknown as { v: string[] }).v ??= []).push(e.violatedDirective)));
  await page.goto("http://127.0.0.1:5181/specimen.html");
  await expect(page.locator("#sets table")).toBeVisible();
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count()).toBe(1);
  violations.push(...((await page.evaluate(() => (window as unknown as { v?: string[] }).v)) ?? []));
  expect(violations).toEqual([]);
});

test("a keyboard that drops out pauses the piece with the reason and a held pedal acts once", async ({ page }) => {
  await page.addInitScript(() => {
    const inputs = new Map<string, { name: string; state: string; onmidimessage: unknown }>();
    const access: { inputs: Map<string, unknown>; onstatechange: (() => void) | null } = { inputs, onstatechange: null };
    (window as unknown as { __midi: unknown }).__midi = {
      plug: (name: string) => {
        inputs.set(name, { name, state: "connected", onmidimessage: null });
        access.onstatechange?.();
      },
      unplug: (name: string) => {
        const i = inputs.get(name);
        if (i) i.state = "disconnected";
        access.onstatechange?.();
      },
      send: (name: string, bytes: number[]) => (inputs.get(name)!.onmidimessage as (e: unknown) => void)?.({ data: new Uint8Array(bytes), timeStamp: performance.now() }),
    };
    Object.defineProperty(navigator, "requestMIDIAccess", { value: () => Promise.resolve(access), configurable: true });
  });
  await open(page, "/devices");
  await page.getByRole("button", { name: "Connect a keyboard" }).click();
  await page.evaluate(() => (window as unknown as { __midi: { plug: (n: string) => void } }).__midi.plug("Keys"));
  await expect(page.getByTestId("connection").locator(".state-line")).toHaveAttribute("data-state", "connected");
  await open(page, "/practise/ode-to-joy");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.getByTestId("play").click();
  // a pedal held down and moved sends a stream of values: the phrase is repeated once, not once for each
  await page.evaluate(() => {
    const m = (window as unknown as { __midi: { send: (n: string, b: number[]) => void } }).__midi;
    for (const v of [70, 90, 127, 127, 110]) m.send("Keys", [0xb0, 64, v]);
  });
  await expect(page.getByTestId("announcer")).toContainText("Phrase 1 of 2");
  await page.evaluate(() => (window as unknown as { __midi: { unplug: (n: string) => void } }).__midi.unplug("Keys"));
  await expect(page.getByTestId("state-word")).toHaveText("Paused");
  await expect(page.locator(".banner")).toContainText("The keyboard stopped responding, so the piece paused");
});
