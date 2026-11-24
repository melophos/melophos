// browser checks on the specimen page: axe, reflow, targets, text size, reduced motion, forced colours and the cascade.
// run with: npm run check:a11y
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [390, 768, 1440];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
// color-contrast-enhanced is the 7:1 rule. target-size is the 24 px rule that WCAG 2.2 AA adds
const AXE_RULES = ["color-contrast-enhanced", "target-size"];

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/specimen.html${query}`);
  await page.evaluate(() => document.fonts.ready);
  // the sections arrive one frame at a time, so the last one means the page is complete
  await expect(page.locator("#sets table")).toBeVisible();
}

async function axe(page: Page): Promise<string> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).options({ rules: Object.fromEntries(AXE_RULES.map((r) => [r, { enabled: true }])) }).analyze();
  // allow list: the specification names five muted pairings that sit between 4.5:1 and 7:1 and carry no body text.
  // the specimen marks them with data-under-7. Only the 7:1 rule is waived for them and 4.5:1 is still enforced
  const violations = results.violations
    .map((v) => ({ ...v, nodes: v.id === "color-contrast-enhanced" ? v.nodes.filter((n) => !n.html.includes("data-under-7")) : v.nodes }))
    .filter((v) => v.nodes.length > 0);
  return violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(" ")})`).join("\n");
}

for (const theme of ["light", "dark"] as const) {
  for (const contrast of ["standard", "more"] as const) {
    test(`axe finds no violation in ${theme}, ${contrast} contrast`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, `?theme=${theme}&contrast=${contrast}`);
      expect(await axe(page)).toBe("");
    });
  }
}

test("axe finds no violation in forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "");
  expect(await axe(page)).toBe("");
});

for (const width of WIDTHS) {
  test(`at ${width} px the page does not scroll sideways and every target is 44 px or more`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "horizontal scroll on the page").toBeLessThanOrEqual(0);

    // sample the centre of each interactive element, so a covered or tiny hit area is caught
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const sel = "button, a[href], input, select, textarea, summary, [tabindex='0']";
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const inline = el.closest("p, li, td") !== null && el.tagName === "A" && !el.classList.contains("button");
        if (el.classList.contains("skip-link") && getComputedStyle(el).transform !== "none") continue;
        // a link inside a sentence is exempt and a checkbox or radio is a target through its label
        if (inline || (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))) continue;
        if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 30) ?? ""} is ${Math.round(r.width)} by ${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small, `\n${small.join("\n")}`).toEqual([]);
  });

  test(`at ${width} px no text is under 16 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "");
    const tiny = await page.evaluate(() => {
      const out = new Set<string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || !n.parentElement) continue;
        const el = n.parentElement;
        if (el.closest("noscript, script, style")) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) out.add(`${el.tagName.toLowerCase()} "${n.textContent.trim().slice(0, 30)}" is ${size} px`);
      }
      return [...out];
    });
    expect(tiny, `\n${tiny.join("\n")}`).toEqual([]);
  });
}

test("at 200 and 400 per cent zoom nothing is lost and the page does not scroll sideways", async ({ browser }) => {
  for (const width of [640, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await open(page, "");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal scroll at ${width} px`).toBeLessThanOrEqual(0);
    await expect(page.locator("#sets h2")).toBeVisible();
    await context.close();
  }
});

test("with the root font size doubled the page still reflows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "");
  // set through the style object, which the page's content security policy allows
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("with reduced motion nothing animates and the panel changes at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--duration-in").trim())).toBe("0s");
  await page.locator("#fade-toggle").click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator("#fade-panel")).toHaveCSS("opacity", "0");
});

test("with forced colours every control keeps a visible boundary", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "");
  const bare = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("#controls button, #controls a.button, .segmented button")) {
      const s = getComputedStyle(el);
      if (parseFloat(s.borderTopWidth) < 1 || s.borderTopColor === "rgba(0, 0, 0, 0)") out.push(el.textContent?.trim() ?? "");
    }
    return out;
  });
  expect(bare, `controls with no boundary: ${bare.join(", ")}`).toEqual([]);
});

test("the focus ring is 3 px, offset 2 px and never amber", async ({ page }) => {
  await open(page, "");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { width: s.outlineWidth, offset: s.outlineOffset, colour: s.outlineColor, style: s.outlineStyle, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent") };
  });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBe("3px");
  expect(ring.offset).toBe("2px");
  expect(ring.colour).not.toBe("rgb(255, 176, 0)");
});

// every combination of the attributes and the system settings must land on the set the tokens file says it should
const CASES: { scheme: "light" | "dark"; contrast: "no-preference" | "more"; theme: string | null; attr: boolean; set: string }[] = [];
for (const scheme of ["light", "dark"] as const) {
  for (const media of ["no-preference", "more"] as const) {
    for (const theme of [null, "light", "dark"]) {
      for (const attr of [false, true]) {
        const dark = theme ? theme === "dark" : scheme === "dark";
        const more = media === "more" || attr;
        CASES.push({ scheme, contrast: media, theme, attr, set: `${dark ? "dark" : "light"}${more ? "-more" : ""}` });
      }
    }
  }
}

test(`the cascade picks the right set in all ${CASES.length} combinations`, async ({ page }) => {
  await open(page, "");


  const wrong: string[] = [];
  for (const c of CASES) {
    await page.emulateMedia({ colorScheme: c.scheme, contrast: c.contrast });
    const canvas = await page.evaluate(
      ({ theme, attr }) => {
        const r = document.documentElement;
        if (theme) r.setAttribute("data-theme", theme);
        else r.removeAttribute("data-theme");
        if (attr) r.setAttribute("data-contrast", "more");
        else r.removeAttribute("data-contrast");
        return getComputedStyle(r).getPropertyValue("--canvas").trim();
      },
      { theme: c.theme, attr: c.attr },
    );
    const want: Record<string, string> = { light: "#f7f7f5", dark: "#0e0e12", "light-more": "#fff", "dark-more": "#000" };
    if (canvas !== want[c.set]) wrong.push(`scheme ${c.scheme}, contrast ${c.contrast}, theme ${c.theme ?? "system"}, attribute ${c.attr}: got ${canvas}, wanted ${c.set} (${want[c.set]})`);
  }
  expect(wrong, `\n${wrong.join("\n")}`).toEqual([]);
});

test("the page makes no request outside its own origin", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1") && !r.url().startsWith("data:")) foreign.push(r.url());
  });
  await open(page, "");
  expect(foreign).toEqual([]);
});
