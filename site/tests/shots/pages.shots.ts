import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { PATHS } from "../e2e/paths.ts";

const DIR = process.env["SHOTS_DIR"] ?? "test-results/shots";
mkdirSync(DIR, { recursive: true });

for (const path of PATHS) {
  for (const width of [390, 768, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${path} at ${width} in ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
        const page = await ctx.newPage();
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const name = (path === "/" ? "home" : path.replaceAll("/", "-").replace(/^-|-$/g, "")) + `-${width}-${theme}.png`;
        await page.screenshot({ path: join(DIR, name), fullPage: true });
        await ctx.close();
      });
    }
  }
}
