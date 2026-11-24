// browser checks on every page of the built site: axe, reflow, targets, text size, no third party request,
// scripts off, reduced motion, forced colours and the two scripts the site has. run with: npm run check:a11y
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PATHS } from "./paths.ts";
import { overlaps } from "./overlap.ts";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const AXE_RULES = ["color-contrast-enhanced", "target-size"];

async function axe(page: Page): Promise<string> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).options({ rules: Object.fromEntries(AXE_RULES.map((r) => [r, { enabled: true }])) }).analyze();
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(" ")})`).join("\n");
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

for (const path of PATHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`${path}: axe finds no violation in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, path);
      expect(await axe(page)).toBe("");
    });
  }

  test(`${path}: axe finds no violation in forced colours and with more contrast`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await open(page, path);
    expect(await axe(page)).toBe("");
    await page.emulateMedia({ forcedColors: "none", contrast: "more" });
    expect(await axe(page)).toBe("");
  });

  for (const width of [320, 390, 768, 1440]) {
    test(`${path}: at ${width} px nothing scrolls sideways and the text and targets are large enough`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "horizontal scroll on the page").toBeLessThanOrEqual(0);

      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input, select, summary")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.classList.contains("skip-link") || el.classList.contains("visually-hidden")) continue;
          // a link inside a sentence or a list item of prose is exempt and needs a line height of 24 px
          const inline = el.tagName === "A" && !el.classList.contains("button") && el.closest("p, li, td, th, dd, figcaption, h2, h3, h4") !== null && el.parentElement?.closest("nav") === null;
          const min = inline ? 24 : 44;
          if (r.height < min - 0.5 || (!inline && r.width < min - 0.5)) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" is ${Math.round(r.width)} by ${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small, `targets under size:\n${small.join("\n")}`).toEqual([]);

      const tiny = await page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? "").trim();
          const el = n.parentElement;
          if (!text || !el || el.closest("svg, script, style")) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 16) out.push(`"${text.slice(0, 30)}" is ${size}px`);
        }
        return out;
      });
      expect(tiny, `text under 16 px:\n${tiny.join("\n")}`).toEqual([]);
    });
  }

  test(`${path}: doubling the text size loses nothing and does not scroll the page sideways`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, path);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  // no two pieces of text print over each other, from a phone to a wide screen, at the normal size and at twice the size
  for (const width of [320, 390, 768, 1024, 1440]) {
    for (const zoom of [100, 200]) {
      test(`${path}: at ${width} px and ${zoom} per cent text no two text boxes overlap`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page, path);
        if (zoom === 200) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        expect(await overlaps(page), "text printed over other text").toEqual([]);
      });
    }
  }

  test(`${path}: makes no request to another origin and raises no error`, async ({ page, baseURL }) => {
    const external: string[] = [];
    const errors: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith(baseURL ?? "")) external.push(r.url());
    });
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("404 (Not Found)")) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, path);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test.describe("scripts off", () => {
  test.use({ javaScriptEnabled: false });
  for (const path of PATHS) {
    test(`${path}: every heading is visible and nothing is hidden at zero opacity`, async ({ page }) => {
      await page.goto(path);
      const headings = await page.locator("main h1, main h2, main h3").all();
      expect(headings.length).toBeGreaterThan(0);
      for (const h of headings) await expect(h).toBeVisible();
      const hidden = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((e) => getComputedStyle(e).opacity === "0").length);
      expect(hidden).toBe(0);
    });
  }
});

test("reduced motion: nothing animates and the figure steps by hand", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await open(page, "/");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const button = page.getByRole("button", { name: "Show the next note" });
  await expect(button).toBeVisible();
  const before = await page.locator("[data-readout]").textContent();
  await button.click();
  expect(await page.locator("[data-readout]").textContent()).not.toBe(before);
  await ctx.close();
});

test("the keyboard figure plays on request, pauses and starts nothing by itself", async ({ page }) => {
  await open(page, "/");
  const readout = page.locator("[data-readout]");
  const first = await readout.textContent();
  await page.waitForTimeout(1500);
  expect(await readout.textContent(), "it must not start by itself").toBe(first);
  const play = page.getByRole("button", { name: "Play the demonstration" });
  await play.click();
  await page.waitForTimeout(2200);
  const moved = await readout.textContent();
  expect(moved).not.toBe(first);
  await page.getByRole("button", { name: "Pause the demonstration" }).click();
  const paused = await readout.textContent();
  await page.waitForTimeout(1500);
  expect(await readout.textContent()).toBe(paused);
  await page.getByRole("button", { name: "Play the demonstration" }).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return { width: s.outlineWidth, style: s.outlineStyle };
  });
  expect(ring).toEqual({ width: "3px", style: "solid" });
});

test("the theme toggle switches, remembers and can return to the system setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "/");
  await page.getByRole("button", { name: "Dark" }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(14, 14, 18)");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  await page.getByRole("button", { name: "System" }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("melophos-theme"))).toBeNull();
});

test("the site is usable from the keyboard alone: the skip link and the main navigation", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("the nav marks the current page by aria-current as well as by the lit disc", async ({ page }) => {
  await open(page, "/hardware/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Hardware" })).toHaveAttribute("aria-current", "page");
});

test("on a phone the menu opens with scripts off and lists every main page", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/hardware/");
  const menu = page.locator("details.menu");
  await expect(menu.getByRole("link", { name: "Roadmap" })).toBeHidden();
  await menu.locator("summary").click();
  const nav = menu.getByRole("navigation", { name: "Main" });
  for (const name of ["How it works", "Hardware", "Accessibility", "Docs", "Roadmap"]) await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Hardware" })).toHaveAttribute("aria-current", "page");
  const box = await page.getByRole("link", { name: "Try it" }).boundingBox();
  const summary = await menu.locator("summary").boundingBox();
  expect(Math.round(box?.y ?? -1), "Try it and Menu share the top row").toBe(Math.round(summary?.y ?? -2));
  await ctx.close();
});

test("the picture of the Studio is drawn by the Studio's own keyboard and lane and does not move", async ({ page }) => {
  await open(page, "/");
  const moment = page.locator(".studio-moment");
  await expect(moment).toHaveAttribute("role", "img");
  await expect(moment.locator(".kb-svg")).toHaveCount(1);
  await expect(moment.locator("canvas.lane-canvas")).toHaveCount(1);
  // one disc for the right hand and one square for the left, as the practice view lights them
  expect(await moment.locator('.key[data-cue="next"][data-hand="right"]').count()).toBe(1);
  expect(await moment.locator('.key[data-cue="next"][data-hand="left"]').count()).toBe(1);
  const before = await moment.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(1000);
  expect(await moment.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(before);
});
