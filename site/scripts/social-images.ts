// draws the card a link shows when it is shared, one for each main page and writes them to public/social/. each card
// is the page's title on the ink of the light bar, with one amber light over a key, set in the site's own typeface.
// a local browser renders this file's own markup, so the cards need no outside service. run after a title changes:
//   npm run social
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { SOCIAL_CARDS } from "../src/lib/social.ts";

const ROOT = join(process.cwd(), "..");
const OUT = join(process.cwd(), "public/social");
const font = readFileSync(join(ROOT, "studio/src/styles/fonts/AtkinsonHyperlegibleNext-Variable.woff2")).toString("base64");
const mark = readFileSync(join(ROOT, "assets/brand/melophos-wordmark-dark.svg"), "utf8");

const W = 1200;
const H = 630;
const escape = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// 22 white keys along the foot of the card, with the black keys between them and one lit key under the light
function keys(lit: number): string {
  const out: string[] = [];
  const kw = W / 22;
  for (let i = 0; i < 22; i++) out.push(`<rect x="${i * kw + 1}" y="470" width="${kw - 2}" height="160" rx="4" fill="${i === lit ? "#ffb000" : "#f2f2f5"}"/>`);
  for (let i = 0; i < 22; i++) if (![2, 6].includes(i % 7)) out.push(`<rect x="${(i + 1) * kw - kw * 0.3}" y="470" width="${kw * 0.6}" height="95" rx="3" fill="#0e0e12"/>`);
  const cx = lit * kw + kw / 2;
  out.push(`<circle cx="${cx}" cy="440" r="14" fill="#ffb000"/>`);
  for (const n of [2, 4]) out.push(`<circle cx="${cx + n * kw}" cy="440" r="9" fill="none" stroke="#a87400" stroke-width="4"/>`);
  return out.join("");
}

function page(title: string, lit: number): string {
  return `<!doctype html><html><head><style>
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 200 800; }
html, body { margin: 0; background: #060608; }
.title { position: absolute; left: 72px; top: 150px; width: 1050px; font: 700 76px/1.05 Atkinson; letter-spacing: -0.02em; color: #f2f2f5; }
.mark { position: absolute; left: 60px; top: 40px; height: 84px; }
.mark svg { height: 84px; width: auto; }
.mark svg > rect:first-child { fill: #060608; }
</style></head><body>
<div class="mark">${mark}</div>
<div class="title">${escape(title)}</div>
<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0"><rect y="410" width="${W}" height="60" fill="#060608"/>${keys(lit)}</svg>
</body></html>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: W, height: H } });
for (const card of SOCIAL_CARDS) {
  await tab.setContent(page(card.title, card.lit));
  await tab.evaluate(() => document.fonts.ready);
  writeFileSync(join(OUT, `${card.slug}.png`), await tab.screenshot({ type: "png" }));
  console.log(`social/${card.slug}.png`);
}
await browser.close();
