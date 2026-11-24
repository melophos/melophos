import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";

const OUT = process.env["SHOTS_DIR"] ?? "test-results/shots";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [390, 768, 1440];

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`${theme} at ${width}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const page = await context.newPage();
      await page.goto(`/specimen.html?theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);
      await page.locator("#sets table").waitFor();
      await page.screenshot({ path: join(OUT, `specimen-${theme}-${width}.png`), fullPage: true });
      await context.close();
    });
  }

  test(`${theme} with more contrast at 1440`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    const page = await context.newPage();
    await page.goto(`/specimen.html?theme=${theme}&contrast=more`);
    await page.evaluate(() => document.fonts.ready);
      await page.locator("#sets table").waitFor();
    await page.screenshot({ path: join(OUT, `specimen-${theme}-more-contrast-1440.png`), fullPage: true });
    await context.close();
  });

  test(`${theme} with forced colours at 1440 and 390`, async ({ browser }) => {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, forcedColors: "active" });
      const page = await context.newPage();
      await page.goto("/specimen.html");
      await page.evaluate(() => document.fonts.ready);
      await page.locator("#sets table").waitFor();
      await page.screenshot({ path: join(OUT, `specimen-forced-colours-${theme}-${width}.png`), fullPage: true });
      await context.close();
    }
  });

  // 200 per cent zoom on a 1280 px window is a 640 px viewport at twice the pixel density. 400 per cent is 320 px
  for (const [name, width] of [["200", 640], ["400", 320]] as const) {
    test(`${theme} at ${name} per cent zoom`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
      const page = await context.newPage();
      await page.goto(`/specimen.html?theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);
      await page.locator("#sets table").waitFor();
      await page.screenshot({ path: join(OUT, `specimen-${theme}-zoom-${name}.png`), fullPage: true });
      await context.close();
    });
  }
}
