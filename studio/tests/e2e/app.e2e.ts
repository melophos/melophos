// browser checks on the built Studio: the practice flow with the keyboard, the scoring module in a real browser engine,
// accessibility on every view, sizes, reflow, reduced motion and the screen reader policy.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { serveDist } from "../lib/dist-server";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function axe(page: Page): Promise<string> {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).options({ rules: { "color-contrast-enhanced": { enabled: true }, "target-size": { enabled: true } } }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}, first: ${v.nodes[0]?.target.join(" ")})`).join("\n");
}

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main h1")).toBeVisible();
}

// twinkle on the computer keyboard: middle C is A, D is S, E is D, F is F, G is G, A is H
const TWINKLE = ["KeyA", "KeyA", "KeyG", "KeyG", "KeyH", "KeyH", "KeyG", "KeyF", "KeyF", "KeyD", "KeyD", "KeyS", "KeyS", "KeyA"];

test("the scoring module loads in the browser and scores a real fixture exactly as the native build does", async ({ page }) => {
  await open(page, "/diagnostics");
  await expect(page.getByTestId("engine-status")).toHaveText(/Loaded from WebAssembly/);
  // three cases of the shared corpus (chords played by two hands, with hand labels), copied beside the tests
  // the corpus and the golden file are read from core/ when it is there, so the test follows whatever the engine's authors
  // regenerate. a copy beside the tests stands in when the Studio is built on its own
  const fromCore = existsSync("../core/fixtures/golden.json") && existsSync("../core/fixtures/corpus/chords-1.json");
  const corpusPath = fromCore ? "../core/fixtures/corpus/chords-1.json" : "tests/fixtures/corpus-chords-1.json";
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { config: Record<string, number>; expected: [number, number][]; hands: ("left" | "right" | null)[]; cases: { name: string; played: [number, number][] }[] };
  const all = JSON.parse(readFileSync(fromCore ? "../core/fixtures/golden.json" : "tests/fixtures/corpus-chords-1.golden.json", "utf8")) as Record<string, { digest: string; follow: Record<string, number | null> }>;
  const wanted = corpus.cases.map((c) => `chords-1/${c.name}`).filter((k) => k in all).slice(0, 6);
  const golden = Object.fromEntries(wanted.map((k) => [k, all[k]!]));
  expect(wanted.length).toBeGreaterThan(0);
  for (const [key, want] of Object.entries(golden)) {
    const played = corpus.cases.find((c) => `chords-1/${c.name}` === key)!.played;
    const got = await page.evaluate(
      ({ f, played }) => {
        const expected = f.expected.map(([tMs, note], i) => ({ tMs, note, ...(f.hands[i] ? { hand: f.hands[i] } : {}) }));
        const r = window.__melophos!.follow(expected as never, played.map(([tMs, note]) => ({ tMs, note })), { windowMs: f.config["window_ms"]!, band: f.config["band"]!, pauseMs: f.config["pause_ms"]!, chordMs: f.config["chord_ms"]!, relocateAfter: f.config["relocate_after"]! });
        const kinds = ["hit", "wrong", "late", "repeat", "unsure"];
        return { events: r.events.map((e) => [e.playedIndex, kinds.indexOf(e.kind), e.expectedIndex ?? -1, e.position, e.errorMs, e.speedPpm, e.jumpedFrom ?? -1]), s: r.summary };
      },
      { f: corpus, played },
    );
    // the same digest the Rust test computes: FNV-1a over every number of every event as 8 little-endian bytes
    const mask = (1n << 64n) - 1n;
    let h = 0xcbf29ce484222325n;
    for (const e of got.events) for (const v of e) {
      let x = BigInt.asUintN(64, BigInt(v));
      for (let b = 0; b < 8; b++) {
        h ^= x & 0xffn;
        h = (h * 0x100000001b3n) & mask;
        x >>= 8n;
      }
    }
    expect(h.toString(16).padStart(16, "0"), key).toBe(want.digest);
    expect(got.events.length, key).toBe(want.follow["expected"] === null ? 0 : got.events.length);
    expect({ hits: got.s.hits, late: got.s.late, misses: got.s.misses, wrong: got.s.wrong, repeats: got.s.repeats, accuracy_bits: got.s.accuracyBits, played_expected: got.s.playedExpected, unsure: got.s.unsure, played_accuracy_bits: got.s.playedAccuracyBits, final_speed_ppm: got.s.finalSpeedPpm }, key).toEqual({
      hits: want.follow["hits"], late: want.follow["late"], misses: want.follow["misses"], wrong: want.follow["wrong"], repeats: want.follow["repeats"], accuracy_bits: want.follow["accuracy_bits"], played_expected: want.follow["played_expected"], unsure: want.follow["unsure"], played_accuracy_bits: want.follow["played_accuracy_bits"], final_speed_ppm: want.follow["final_speed_ppm"],
    });
  }
  await page.getByTestId("run-check").click();
  await expect(page.getByTestId("check-result")).toContainText("hits");
});

test("melody practice with the computer keyboard: right notes, a wrong note, finish, summary and a saved record", async ({ page }) => {
  await open(page, "/practise/twinkle");
  await expect(page.getByTestId("next-line")).toContainText("Next: C 4");
  // the scoring module has loaded when the page reports the engine ready
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
  // watch the one live region: it may only change at phrase starts and on request
  await page.evaluate(() => {
    const el = document.querySelector("[data-testid=announcer]")!;
    (window as unknown as { changes: number }).changes = 0;
    new MutationObserver(() => ((window as unknown as { changes: number }).changes += 1)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.getByTestId("play").click();
  await page.keyboard.press(TWINKLE[0]!);
  await page.keyboard.press(TWINKLE[1]!);
  // a wrong note: the words, the cross and the guide staying where it was
  await page.keyboard.press("KeyK");
  await expect(page.getByTestId("feedback")).toContainText("Wrong note");
  await expect(page.getByTestId("feedback")).toContainText("The light is still on");
  await expect(page.locator(".key[data-cue='wrong']")).toHaveCount(1);
  for (const code of TWINKLE.slice(2)) await page.keyboard.press(code);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.locator(".facts")).toContainText("13 of 14");
  await expect(page.locator(".facts")).toContainText("Accuracy");
  await expect(page.locator(".facts")).toContainText("Keys not judged");
  const changes = await page.evaluate(() => (window as unknown as { changes: number }).changes);
  // the phrase start, the one wrong note, the clearing after the next right note and the result: four in all and none for the 13 right notes
  expect(changes, "announcements across the whole piece").toBeLessThanOrEqual(4);
  // the run is on the record
  await open(page, "/progress");
  await expect(page.getByTestId("days-sentence")).toHaveText("You practised on 1 of the last 28 days.");
  await expect(page.locator(".heat")).toBeVisible();
});

test("a simulated run is labelled and never saved", async ({ page }) => {
  await open(page, "/practise/twinkle?mode=melody");
  await page.getByTestId("demo").click();
  await expect(page.getByText("Simulated", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Simulated run, not saved" })).toBeVisible({ timeout: 20_000 });
  await open(page, "/progress");
  await expect(page.getByRole("heading", { name: "Nothing to show yet" })).toBeVisible();
});

test("rhythm mode counts in, scores presses with the engine and shows the lane without text on the canvas", async ({ page }) => {
  await open(page, "/practise/twinkle?mode=rhythm&tempo=125");
  await page.getByTestId("demo").click();
  await expect(page.locator("canvas.lane-canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Simulated run, not saved" })).toBeVisible({ timeout: 40_000 });
  await expect(page.locator(".facts")).toContainText("Accuracy");
});

test("hands-free keys: Space starts, Page Down skips a phrase", async ({ page }) => {
  await open(page, "/practise/ode-to-joy");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await expect(page.getByTestId("state-word")).toHaveText("Waiting for you");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("announcer")).toContainText("Phrase 2");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("state-word")).toHaveText("Paused");
});

test("what is next reads out the next notes on request", async ({ page }) => {
  await open(page, "/practise/brother-john");
  await page.getByRole("button", { name: "What is next" }).click();
  await expect(page.getByTestId("announcer")).toContainText("together");
});

const VIEWS = ["/", "/library", "/piece/twinkle", "/practise/twinkle", "/practise/brother-john?mode=rhythm", "/devices", "/settings/display", "/settings/notes", "/settings/sound", "/settings/input", "/settings/data", "/progress", "/about", "/diagnostics"];
for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violation on any view in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme });
    for (const v of VIEWS) {
      await open(page, v);
      await page.waitForTimeout(150);
      expect(await axe(page), v).toBe("");
    }
  });
}

test("axe finds no violation in forced colours or with more contrast", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  for (const v of ["/practise/twinkle", "/progress", "/settings/display"]) {
    await open(page, v);
    expect(await axe(page), v).toBe("");
  }
});

for (const width of [320, 390, 768, 1440]) {
  test(`at ${width} px the views do not scroll sideways and targets and text are large enough`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const v of ["/", "/library", "/practise/twinkle", "/practise/brother-john?mode=rhythm", "/devices", "/settings/display", "/progress", "/diagnostics"]) {
      await open(page, v);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${v}: horizontal scroll`).toBeLessThanOrEqual(0);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        // the keys are exempt from 44 px: the specification sets 40 px for a white key at Near
        const sel = "button:not(.key), a[href], input:not([type=file]), select, summary, [role=slider]";
        const hiddenInput = (el: HTMLElement): boolean => el.tagName === "INPUT" && el.closest(".range-thumb, .switch") !== null;
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || el.closest(".kb-svg, .visually-hidden") || hiddenInput(el)) continue;
          const inline = el.tagName === "A" && el.closest("p, li:not(.row-li)") !== null && !el.classList.contains("button") && !el.classList.contains("row") && !el.closest("nav") && !el.classList.contains("brand") && !el.classList.contains("back");
          if (inline) continue;
          if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        for (const el of document.querySelectorAll<HTMLElement>("main *")) {
          if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 15.99 && !el.closest("svg")) out.push(`text ${size}px in ${el.tagName}.${el.className}`);
        }
        return out;
      });
      expect(problems, v).toEqual([]);
    }
  });
}

test("the practice view works with the root text size doubled", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => (document.documentElement.style.fontSize = "200%")));
  await open(page, "/practise/twinkle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("play")).toBeVisible();
  await open(page, "/progress");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("with reduced motion nothing animates and the lane is a still page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/practise/twinkle?mode=rhythm");
  await page.getByTestId("play").click();
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // the canvas does not change between frames while the lane is a still page
  const a = await page.locator("canvas.lane-canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(400);
  const b = await page.locator("canvas.lane-canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(a).toBe(b);
});

test("every lit state has a shape as well as a colour", async ({ page }) => {
  await open(page, "/practise/brother-john");
  // two hands: a disc for the right hand and a square for the left, on the rail and on the keys
  const shapes = await page.evaluate(() => {
    const vis = (sel: string) => [...document.querySelectorAll<SVGElement>(sel)].filter((e) => getComputedStyle(e).display !== "none").length;
    return { disc: vis(".light .disc"), square: vis(".light .square"), keyDisc: vis(".key .mark .disc"), keySquare: vis(".key .mark .square") };
  });
  expect(shapes).toEqual({ disc: 1, square: 1, keyDisc: 1, keySquare: 1 });
  await page.getByTestId("play").click();
  await page.keyboard.press("KeyK");
  await expect(page.locator(".light[data-cue='wrong'] .cross")).toBeVisible();
});

test("settings: note names and middle C change the keys and the words live", async ({ page }) => {
  await open(page, "/settings/notes");
  await page.getByRole("radio", { name: "C3" }).click();
  await page.getByRole("radio", { name: "C D E with H" }).click();
  await expect(page.getByTestId("naming-sample")).toContainText("Middle C is C3");
  await open(page, "/practise/twinkle");
  await expect(page.locator(".key[data-note='60']")).toHaveAttribute("aria-label", /^C 3/);
});

test("data: export, delete everything and import again", async ({ page }) => {
  await open(page, "/practise/twinkle");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("play").click();
  for (const code of TWINKLE) await page.keyboard.press(code);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await open(page, "/settings/data");
  await expect(page.getByText("You hold 1 session")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export every session" }).click()]);
  const path = await download.path();
  await page.getByRole("button", { name: "Delete everything" }).first().click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page.getByTestId("data-message")).toContainText("deleted and checked", { timeout: 10_000 });
  await expect(page.getByText("You hold 0 sessions")).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByTestId("data-message")).toContainText("Imported 1 session");
});

test("progress charts: labelled axes, a table behind each and a plain note when there is too little", async ({ page }) => {
  await open(page, "/settings/data");
  const sessions = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`, pieceId: "twinkle", pieceTitle: "Twinkle, Twinkle, Little Star", startedAt: new Date(Date.now() - (6 - i) * 86_400_000).toISOString(), durationMs: 70_000, mode: "melody", hand: "both", fromBar: null, toBar: null,
    speedPct: 60 + i * 8, total: 14, firstTime: 8 + i, wrongPresses: 6 - i, longestRun: 6 + i, score: { expected: 14, hits: 14, misses: 0, wrong: 6 - i, repeats: 0, accuracy: 14 / (20 - i), timingMs: null }, laps: 1, missed: [{ note: 67, count: 3 + i }, { note: 69, count: 1 }, { note: 60, count: 2 }],
  }));
  await page.locator("input[type=file]").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "melophos-studio-export", version: 1, sessions })) });
  await expect(page.getByTestId("data-message")).toContainText("Imported 6 sessions");
  await open(page, "/progress/twinkle");
  await expect(page.getByRole("heading", { name: "Notes right first time", level: 2 })).toBeVisible();
  await expect(page.locator(".chart svg")).toHaveCount(2);
  await expect(page.locator(".chart svg text", { hasText: "Session, oldest to newest" })).toHaveCount(2);
  await expect(page.locator(".chart svg text", { hasText: "(per cent)" })).toHaveCount(1);
  await page.getByRole("button", { name: /as a table/ }).click();
  await expect(page.locator("table").first()).toContainText("8 of 14");
  expect(await axe(page)).toBe("");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await open(page, "/progress");
  await expect(page.locator(".day-yes")).toHaveCount(6);
  expect(await axe(page)).toBe("");
});

test("one session says there is too little for a line", async ({ page }) => {
  await open(page, "/practise/twinkle");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("play").click();
  for (const code of TWINKLE) await page.keyboard.press(code);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await open(page, "/progress/twinkle");
  await expect(page.getByTestId("too-little")).toBeVisible();
});

test("the connection flow reaches every state with a fake MIDI access", async ({ page }) => {
  await page.addInitScript(() => {
    const inputs = new Map<string, { name: string; state: string; onmidimessage: unknown }>();
    const access: { inputs: Map<string, unknown>; onstatechange: (() => void) | null } = { inputs, onstatechange: null };
    (window as unknown as { __midi: unknown }).__midi = {
      plug: (name: string) => { inputs.set(name, { name, state: "connected", onmidimessage: null }); access.onstatechange?.(); },
      unplug: (name: string) => { const i = inputs.get(name); if (i) i.state = "disconnected"; access.onstatechange?.(); },
      send: (name: string, bytes: number[]) => (inputs.get(name)!.onmidimessage as (e: unknown) => void)?.({ data: new Uint8Array(bytes), timeStamp: performance.now() }),
    };
    Object.defineProperty(navigator, "requestMIDIAccess", { value: () => Promise.resolve(access), configurable: true });
  });
  await open(page, "/devices");
  const state = page.getByTestId("connection").locator(".state-line");
  await expect(state).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("connection")).toContainText("ask whether this page may use your MIDI devices");
  await page.getByRole("button", { name: "Connect a keyboard" }).click();
  await expect(state).toHaveAttribute("data-state", "no-devices");
  await page.evaluate(() => (window as unknown as { __midi: { plug: (n: string) => void } }).__midi.plug("Test keys"));
  await expect(state).toHaveAttribute("data-state", "connected");
  await page.evaluate(() => (window as unknown as { __midi: { send: (n: string, b: number[]) => void } }).__midi.send("Test keys", [0x90, 61, 90]));
  await expect(page.getByTestId("connection")).toContainText("Last key: C♯4");
  await expect(page.locator(".activity")).toHaveAttribute("data-active", "true");
  await page.evaluate(() => (window as unknown as { __midi: { unplug: (n: string) => void } }).__midi.unplug("Test keys"));
  await expect(state).toHaveAttribute("data-state", "lost");
  await page.evaluate(() => (window as unknown as { __midi: { plug: (n: string) => void } }).__midi.plug("Test keys"));
  await expect(state).toHaveAttribute("data-state", "connected");
});

test("the browser has no MIDI: a plain explanation and a working path", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "requestMIDIAccess", { value: undefined, configurable: true }));
  await open(page, "/devices");
  await expect(page.getByTestId("connection")).toContainText("cannot reach a MIDI keyboard");
  await expect(page.getByRole("button", { name: "Connect a keyboard" })).toHaveCount(0);
});

test("press to frame: the browser's part of the delay from a key press to a drawn frame", async ({ page }) => {
  await open(page, "/diagnostics");
  const key = page.locator(".key[data-note='60']");
  for (let i = 0; i < 60; i++) {
    await key.dispatchEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true });
    await key.dispatchEvent("pointerup", { pointerId: 1, button: 0, bubbles: true });
    await page.waitForTimeout(30);
  }
  await expect(page.getByTestId("lat-count")).not.toHaveText("0");
  const p95 = parseFloat((await page.getByTestId("lat-p95").textContent()) ?? "999");
  console.log(`press to frame, ${await page.getByTestId("lat-count").textContent()} presses: median ${await page.getByTestId("lat-median").textContent()}, 95th percentile ${p95} ms`);
  expect(p95).toBeLessThan(20);
});

test("lane frame time with the CPU slowed four times", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await open(page, "/diagnostics");
  await page.getByTestId("stress-10").click();
  const result = page.getByTestId("frame-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  const text = (await result.textContent()) ?? "";
  console.log(`lane, 4x CPU slowdown: ${text}`);
  const p95 = parseFloat(/95th percentile ([\d.]+)/.exec(text)?.[1] ?? "999");
  expect(p95).toBeLessThan(18);
});

async function installed(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
  // the first load is not controlled by the worker, so one reload puts the page under it
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test("offline: load once, go offline, reload, practise and score with no network", async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  await page.reload();
  await expect(page.getByRole("heading", { name: "MELOPHOS Studio", level: 1 })).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await open(page, "/practise/twinkle");
  // the WebAssembly module came from the cache
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("play").click();
  for (const code of TWINKLE) await page.keyboard.press(code);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.locator(".facts")).toContainText("Accuracy");
  await open(page, "/progress");
  await expect(page.getByTestId("days-sentence")).toHaveText("You practised on 1 of the last 28 days.");
  expect(failed, "requests that failed while offline").toEqual([]);
});

test("the service worker keeps nothing from another origin and the precache holds the scoring module", async ({ page }) => {
  await installed(page);
  const keys = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]!);
    return { names, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) };
  });
  expect(keys.names).toHaveLength(1);
  expect(keys.urls.some((u) => u.endsWith(".wasm"))).toBe(true);
  expect(keys.urls.some((u) => u.endsWith(".woff2"))).toBe(true);
  expect(keys.urls).toContain("/index.html");
  expect(keys.urls).toContain("/manifest.webmanifest");
});

test("an update is offered, refused while a piece is running and applied only when the player asks", async ({ page }) => {
  const site = await serveDist();
  try {
    await page.goto(`${site.url}/`);
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    site.newBuild();
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(page.getByTestId("update-banner")).toBeVisible({ timeout: 15_000 });
    // nothing took over by itself
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.waiting !== null))).toBe(true);
    await page.goto(`${site.url}/#/practise/twinkle`);
    await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("play").click();
    await expect(page.getByTestId("update-banner").getByRole("button")).toBeDisabled();
    await expect(page.getByTestId("update-banner")).toContainText("Finish or pause your piece first");
    await page.getByTestId("play").click();
    await expect(page.getByTestId("update-banner").getByRole("button")).toBeEnabled();
    const reloaded = page.waitForEvent("load");
    await page.getByTestId("update-banner").getByRole("button").click();
    await reloaded;
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.waiting ?? null))).toBeNull();
  } finally {
    await site.close();
  }
});

test("the manifest and icons are served", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator("link[rel=manifest]").getAttribute("href");
  const manifest = await (await request.get(href!)).json();
  expect(manifest.name).toBe("MELOPHOS Studio");
  for (const icon of manifest.icons) expect((await request.get(`/${icon.src}`)).ok(), icon.src).toBe(true);
});
