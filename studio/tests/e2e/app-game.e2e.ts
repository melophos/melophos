// the rhythm game: results from the engine's figures, a best for each song and each setting, silence by default and the
// rules for children and for people with disabilities
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// twinkle at 125 per cent is 120 beats a minute: a beat is 500 ms and the count-in is four beats
const NOTES: { key: string; beat: number }[] = [
  { key: "KeyA", beat: 0 }, { key: "KeyA", beat: 1 }, { key: "KeyG", beat: 2 }, { key: "KeyG", beat: 3 }, { key: "KeyH", beat: 4 }, { key: "KeyH", beat: 5 }, { key: "KeyG", beat: 6 },
  { key: "KeyF", beat: 8 }, { key: "KeyF", beat: 9 }, { key: "KeyD", beat: 10 }, { key: "KeyD", beat: 11 }, { key: "KeyS", beat: 12 }, { key: "KeyS", beat: 13 }, { key: "KeyA", beat: 14 },
];
const BEAT_MS = 500;

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await expect(page.locator("main h1")).toBeVisible();
}

// starts a game and plays it by the clock. with `wrong` it presses a key that is in no note of the piece instead
async function play(page: Page, hash: string, how: "right" | "nothing" | "wrong" = "right"): Promise<void> {
  await open(page, hash);
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("play").click();
  const began = Date.now();
  if (how === "right") {
    for (const n of NOTES) {
      const at = 4 * BEAT_MS + n.beat * BEAT_MS;
      await page.waitForTimeout(Math.max(0, at - (Date.now() - began)));
      await page.keyboard.press(n.key);
    }
  } else if (how === "wrong") {
    await page.waitForTimeout(4 * BEAT_MS + 200);
    await page.keyboard.press("KeyK");
  }
  await page.waitForTimeout(how === "right" ? 1200 : 300);
  // the run may already have ended by itself after the last note
  const finish = page.getByRole("button", { name: "Finish" });
  if (await finish.isEnabled()) await finish.click();
}

const EASY = "/game/twinkle?tempo=125&hand=both";

test("the result is the engine's figures and the first result is the best", async ({ page }) => {
  await play(page, EASY);
  const panel = page.getByTestId("game-result");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("new-best")).toContainText("First result, kept as your best");
  await expect(panel).toContainText("Accuracy");
  await expect(panel).toContainText("Notes hit");
  await expect(panel).toContainText("It is only what the engine thinks");
  // a share of keys the engine was not sure about is always shown, with its plain meaning, even when it is none
  await expect(page.getByTestId("not-judged")).toContainText("count neither for you nor against you");
  // every number comes from the record the engine's summary made: the saved session says the same
  const shown = await page.getByTestId("game-result").locator("dd").allTextContents();
  await open(page, "/progress/twinkle");
  await expect(page.locator("tbody").first()).toContainText(shown[0]!.replace(".0%", "").slice(0, 2));
});

test("a best is kept for each song and each setting and a worse run never replaces it", async ({ page }) => {
  await play(page, EASY, "right");
  await expect(page.getByTestId("new-best")).toBeVisible();
  const first = await page.getByTestId("game-result").locator("dd").first().textContent();
  // a worse run on the same settings: only a wrong key
  await play(page, EASY, "wrong");
  await expect(page.getByTestId("best-sentence")).toContainText(`still ${first}`);
  await expect(page.getByTestId("new-best")).toHaveCount(0);
  // the same song at another speed is its own best, so the full speed one is not touched
  await play(page, "/game/twinkle?tempo=125&hand=right", "wrong");
  await expect(page.getByTestId("new-best")).toContainText("First result");
  await open(page, "/bests");
  const rows = page.locator("table").first().locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("table").first()).toContainText("125% speed, both hands, the whole piece");
  await expect(page.locator("table").first()).toContainText("125% speed, right hand, the whole piece");
  // they are still there after a reload
  await page.reload();
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(2);
  await open(page, "/piece/twinkle");
  await expect(page.getByTestId("game-panel")).toContainText("125% speed, both hands");
});

test("bests travel with an export and an import and go with Delete everything", async ({ page }) => {
  await play(page, EASY, "right");
  await expect(page.getByTestId("new-best")).toBeVisible();
  await open(page, "/settings/data");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export every session" }).click()]);
  const path = await download.path();
  await page.getByTestId("delete-everything").click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page.getByTestId("data-message")).toContainText("deleted and checked");
  await open(page, "/bests");
  await expect(page.getByRole("heading", { name: "No bests yet" })).toBeVisible();
  await open(page, "/settings/data");
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByTestId("data-message")).toContainText("Imported");
  await open(page, "/bests");
  await expect(page.locator("table").first()).toContainText("125% speed, both hands");
});

test("a best from an earlier version of the engine is kept, shown apart and never compared", async ({ page }) => {
  await open(page, "/settings/data");
  const old = { id: "twinkle|both|125|0-0|oldengine", songId: "twinkle", songTitle: "Twinkle, Twinkle, Little Star", difficulty: { hand: "both", speedPct: 125, fromBar: null, toBar: null }, engine: "oldengine", achievedAt: "2026-11-20T10:00:00Z", accuracy: 0.99, hits: 14, late: 0, misses: 0, wrong: 0, expected: 14 };
  await page.locator("input[type=file]").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "melophos-studio-export", version: 1, sessions: [], bests: [old] })) });
  await expect(page.getByTestId("data-message")).toContainText("Imported");
  // a new result is its own first one, not compared with the 99 per cent of the earlier engine
  await play(page, EASY, "wrong");
  await expect(page.getByTestId("new-best")).toContainText("First result");
  await open(page, "/bests");
  await expect(page.getByText("Earlier results (1)")).toBeVisible();
  await page.getByText("Earlier results (1)").click();
  await expect(page.locator("details")).toContainText("99.0%");
  await expect(page.locator("details")).toContainText("not compared with new results");
});

test("the game makes no sound until the player turns it on", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __audio: number }).__audio = 0;
    const Original = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class extends Original {
      constructor(...a: ConstructorParameters<typeof AudioContext>) {
        super(...a);
        (window as unknown as { __audio: number }).__audio += 1;
      }
    };
  });
  await play(page, EASY, "wrong");
  expect(await page.evaluate(() => (window as unknown as { __audio: number }).__audio)).toBe(0);
  await open(page, "/");
  await open(page, EASY);
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.getByText("Sound in the game").click();
  await page.getByTestId("play").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: number }).__audio)).toBeGreaterThan(0);
});

test("the difficulty is tempo, hands and bars and nothing about how strictly notes are judged", async ({ page }) => {
  await open(page, EASY);
  const setup = page.locator("details.setup");
  await expect(setup).toContainText("Speed");
  await expect(setup).toContainText("Hand");
  await expect(setup).toContainText("Bars to practise");
  await expect(setup).not.toContainText(/strict|window|timing|forgiv|level|stars|points/i);
  // a change of setting is a different game with its own best and the address says which
  await page.getByRole("radio", { name: "Left" }).click();
  await expect(page).toHaveURL(/hand=left/);
  await expect(page.locator("h1")).toContainText("Rhythm game");
});

test("the result and a new best are announced once, politely", async ({ page }) => {
  await open(page, EASY);
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.evaluate(() => {
    const el = document.querySelector("[data-testid=announcer]")!;
    (window as unknown as { said: string[] }).said = [];
    new MutationObserver(() => (window as unknown as { said: string[] }).said.push(el.textContent ?? "")).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.getByTestId("play").click();
  await page.waitForTimeout(4 * BEAT_MS + 100);
  await page.keyboard.press("KeyK");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByTestId("game-result")).toBeVisible();
  const said = (await page.evaluate(() => (window as unknown as { said: string[] }).said)).filter((t) => t.startsWith("Finished"));
  expect(said).toHaveLength(1);
  expect(said[0]).toMatch(/Finished\. \d+(\.\d)?% accuracy\. \d+ of \d+ notes hit\. New best\./);
  expect(await page.getByTestId("announcer").getAttribute("role")).toBe("status");
});

test("nothing flashes more than three times a second at the fastest the game can go", async ({ page }) => {
  await open(page, "/game/c-major-scale?tempo=125");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.evaluate(() => {
    const stamps = new Map<Element, number[]>();
    (window as unknown as { stamps: Map<Element, number[]> }).stamps = stamps;
    // only a real change of value counts: the same value written again shows nothing
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (el.getAttribute(r.attributeName!) === r.oldValue) continue;
        const list = stamps.get(el) ?? [];
        list.push(performance.now());
        stamps.set(el, list);
      }
    }).observe(document.querySelector(".practice")!, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ["data-active", "data-count", "data-cue", "data-held", "aria-pressed"] });
  });
  await page.getByTestId("play").click();
  await page.waitForTimeout(6500);
  const worst = await page.evaluate(() => {
    let max = 0;
    for (const times of (window as unknown as { stamps: Map<Element, number[]> }).stamps.values()) {
      for (let i = 0; i < times.length; i++) {
        let n = 0;
        for (let j = i; j < times.length && times[j]! - times[i]! < 1000; j++) n += 1;
        max = Math.max(max, n);
      }
    }
    return max;
  });
  // a change in one direction and back is two changes: three flashes a second is six
  expect(worst).toBeLessThanOrEqual(6);
});

test("with reduced motion the game is still readable and still playable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await play(page, EASY, "right");
  await expect(page.getByTestId("game-result")).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test("the game and the bests pass axe in both themes, with 44 px targets and no sideways scroll at 320 px", async ({ page }) => {
  test.setTimeout(90_000);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const v of ["/game/twinkle", "/bests"]) {
      await open(page, v);
      await page.waitForTimeout(200);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"]).options({ rules: { "color-contrast-enhanced": { enabled: true }, "target-size": { enabled: true } } }).analyze();
      expect(results.violations.map((x) => `${x.id} ${x.nodes[0]?.target.join(" ")}`), `${v} ${theme}`).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  for (const v of ["/game/twinkle", "/bests"]) {
    await open(page, v);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), v).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main button:not(.key), main a.button, main summary, main input:not([hidden]):not([type=file])")].filter((e) => !e.closest(".kb-svg, .range-thumb, .switch") && (e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5)).map((e) => `${e.tagName} ${e.textContent?.slice(0, 20)}`));
    expect(small, v).toEqual([]);
  }
});

test("a game result is not sent anywhere: the saved server is not called when a game ends", async ({ page }) => {
  const calls: string[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  await page.route("https://own.test/**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(route.request().url().includes("signin") ? { token: "tok" } : { status: "ok" }) });
  });
  await open(page, "/settings/server");
  await page.getByTestId("server-address").fill("https://own.test");
  await page.getByTestId("server-save").click();
  await page.getByLabel("Email").fill("me@example.net");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("server-message")).toContainText("Signed in");
  // the settings page asks the server about its storage once it is signed in. let that finish before counting
  await expect(page.getByTestId("server-usage")).toBeVisible();
  const before = calls.length;
  await play(page, EASY, "wrong");
  await expect(page.getByTestId("game-result")).toBeVisible();
  await open(page, "/bests");
  expect(calls.slice(before)).toEqual([]);
});
