// checks the exported site in out/. the build fails on any of these:
// a broken link or fragment, an image with no alt text, a third party request, an inline script or style,
// a duplicate id, a page without one h1, a missing sitemap entry, text that breaks the writing rules
// and, in a production build, any placeholder the owner has not filled.
// run on its own with: node scripts/verify-dist.ts   (--links-only runs only the link checks)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { wordProblems } from "../src/lib/words.ts";
import { PLACEHOLDERS, PLACEHOLDER_MARKER, placeholder } from "../src/site.config.ts";
import { PAGE_FIGURES } from "../src/lib/facts.ts";
import { STATUS_WORD } from "../src/data/status.ts";
import { STUDIO_CLAIMS } from "../src/data/studio-state.ts";
import { hardwareProblems, privateProblems } from "../src/lib/guards.ts";
import { proseSentences, visibleText } from "../src/lib/words.ts";

const DIST = join(process.cwd(), "out");
const linksOnly = process.argv.includes("--links-only");
const production = process.env["MELOPHOS_PRODUCTION"] === "1";
// addresses that the hosting file redirects, so no file exists for them
const REDIRECTED = new Set(["/try"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DIST);
const pages = files.filter((f) => f.endsWith(".html"));
const problems: string[] = [];
const fail = (page: string, msg: string): void => void problems.push(`${relative(DIST, page)}: ${msg}`);

const ids = new Map<string, Set<string>>();
const html = new Map<string, string>();
const route = (file: string): string => {
  const r = "/" + relative(DIST, file).split("\\").join("/");
  return r.endsWith("/index.html") ? r.slice(0, -"index.html".length) : r;
};
for (const p of pages) {
  const text = readFileSync(p, "utf8");
  html.set(p, text);
  ids.set(route(p), new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "")));
}

const target = (path: string): string | null => {
  // an address may carry escaped characters, such as the brackets of a dynamic route's folder
  const clean = decodeURIComponent(path.split("?")[0] ?? path);
  for (const c of [clean, `${clean}index.html`, `${clean}/index.html`]) {
    if (existsSync(join(DIST, c)) && statSync(join(DIST, c)).isFile()) return c;
  }
  return null;
};

for (const [page, text] of html) {
  const here = route(page);
  for (const m of text.matchAll(/<a\s[^>]*?href="([^"]*)"/g)) {
    const href = m[1] ?? "";
    if (/^(https?:|mailto:|tel:)/.test(href) || REDIRECTED.has(href)) continue;
    const [path = "", frag] = href.split("#");
    const dest = path === "" ? here : path;
    const file = target(dest.startsWith("/") ? dest : new URL(dest, `http://x${here}`).pathname);
    if (!file) {
      fail(page, `broken link ${href}`);
      continue;
    }
    if (frag) {
      const set = ids.get(route(join(DIST, file)));
      if (set && !set.has(frag)) fail(page, `broken fragment ${href}`);
    }
  }
  for (const m of text.matchAll(/<(?:link|script|img|source)\s[^>]*?(?:href|src)="([^"]*)"/g)) {
    const ref = m[1] ?? "";
    if (/^(?:https?:)?\/\//.test(ref) && !/rel="(?:canonical|alternate)"/.test(m[0])) fail(page, `loads ${ref}`);
    else if (ref.startsWith("/") && !target(ref)) fail(page, `missing file ${ref}`);
  }
}

if (!linksOnly) {
  const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
  for (const [page, text] of html) {
    const here = route(page);
    for (const m of text.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) fail(page, `image with no alt text ${m[0].slice(0, 60)}`);
    // a JSON-LD block is data that the browser never runs. any other script without a src is inline code
    if (/<script(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")[^>]*>/.test(text)) fail(page, "inline script");
    for (const m of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const data = JSON.parse(m[1] ?? "") as { "@context"?: string };
        if (data["@context"] !== "https://schema.org") fail(page, "structured data without the schema.org context");
      } catch {
        fail(page, "structured data that is not valid JSON");
      }
    }
    if (/\sstyle="/.test(text) || /<style[\s>]/.test(text)) fail(page, "inline style");
    if (/\son[a-z]+="/.test(text)) fail(page, "inline event handler");
    const h1 = text.match(/<h1[\s>]/g)?.length ?? 0;
    if (h1 !== 1) fail(page, `${h1} h1 elements`);
    if (!/<html lang="en-GB"/.test(text)) fail(page, "no lang=en-GB");
    if (!/<title>[^<]+<\/title>/.test(text)) fail(page, "no title");
    const all = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "");
    const dup = all.filter((v, i) => all.indexOf(v) !== i);
    if (dup.length > 0) fail(page, `duplicate ids ${[...new Set(dup)].join(", ")}`);
    if (!/noindex/.test(text) && here !== "/404.html" && !sitemap.includes(`https://melophos.com${here}<`)) fail(page, "not in the sitemap");
    for (const w of wordProblems(text)) fail(page, w);
    if (production && text.includes(PLACEHOLDER_MARKER)) {
      // name each one, so the owner knows what to supply. a document's marker is matched by its own text
      const plain = text.replaceAll("<!-- -->", "").replace(/&#39;|&#x27;/g, "'");
      const named = Object.values(PLACEHOLDERS)
        .filter((p) => p.value === null && (plain.includes(placeholder(p.id)) || p.docs.some((d) => plain.includes(d.text))))
        .map((p) => p.id);
      fail(page, `an owner placeholder is still in the page: ${PLACEHOLDER_MARKER} (${named.join(", ") || "not in the list"})`);
    }
  }
}

if (!linksOnly) {
  // react separates two pieces of text that sit side by side with an empty comment. it is not text, so the checks
  // that read a sentence across it read the page without it
  const byRoute = new Map([...html].map(([page, text]) => [route(page), text.replaceAll("<!-- -->", "")]));
  const page = (path: string): string => byRoute.get(path) ?? "";
  // every figure a page must state, read from the source it comes from: the page fails when it stops stating it
  for (const f of PAGE_FIGURES) if (!page(f.page).includes(f.text())) problems.push(`${f.page}: does not state ${f.why} ("${f.text()}")`);
  // every owner placeholder shows on each page that needs it, as the marked sentence or as its value
  for (const p of Object.values(PLACEHOLDERS)) {
    for (const path of p.pages) {
      const text = page(path).replace(/&#39;|&#x27;/g, "'");
      const shown = path.startsWith("/docs/") ? (p.value === null ? p.docs.some((d) => text.includes(d.text)) : true) : text.includes(placeholder(p.id));
      if (!shown) problems.push(`${path}: the ${p.id} row (${p.what}) is missing from the page`);
    }
  }
  // the status words: every status mark on every page is a word from the one list
  const words = new Set(Object.values(STATUS_WORD));
  for (const [file, text] of html) {
    for (const m of text.matchAll(/<span class="status"[^>]*>[\s\S]*?<span[^>]*>([^<]*)<\/span><\/span>/g)) if (!words.has(m[1] ?? "")) fail(file, `a status word that is not on the list: "${m[1]}"`);
  }
  // no private name or personal link anywhere in a built page or the feed and no sentence that says hardware exists
  for (const [file, text] of html) {
    const here = route(file);
    for (const p of privateProblems(text.replace(/<head[\s\S]*?<\/head>/, "") + visibleText(text))) fail(file, p);
    for (const p of hardwareProblems(here, proseSentences(text))) fail(file, p);
  }
  // every page's sharing card is a file the site serves
  for (const [file, text] of html) {
    const og = /<meta property="og:image" content="https:\/\/melophos\.com([^"]+)"/.exec(text)?.[1];
    if (!og) fail(file, "no sharing image");
    else if (!target(og)) fail(file, `the sharing image ${og} is not in the site`);
  }
  // the map for language tools lists every page the sitemap lists
  const llms = readFileSync(join(DIST, "llms.txt"), "utf8");
  for (const m of readFileSync(join(DIST, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) if (!llms.includes(`(${m[1]})`)) problems.push(`llms.txt: does not list ${m[1]}`);
  const wholeFeed = readFileSync(join(DIST, "changelog.xml"), "utf8");
  for (const p of privateProblems(wholeFeed)) problems.push(`changelog.xml: ${p}`);
  // the origin sentence is told once, in the founder's note and not word for word on other pages
  const origin = [...html].filter(([, text]) => visibleText(text).includes("scanning across a wide 88-key keyboard"));
  if (origin.length > 1) problems.push(`the monocular vision sentence is on ${origin.length} pages (${origin.map(([f]) => relative(DIST, f)).join(", ")}): keep it once`);
  // a figure never prints with the digits of a floating point sum
  for (const [file, text] of html) if (/\b\d+\.\d{6,}\b/.test(visibleText(text))) fail(file, "a number with a long decimal tail");
  // one claim, one status: wherever a Studio statement appears the status word just before it is the claim's own
  const wordsList = Object.values(STATUS_WORD);
  for (const [file, text] of html) {
    const plain = visibleText(text.replaceAll("<!-- -->", "")).replace(/&#39;|&#x27;/g, "'");
    for (const c of STUDIO_CLAIMS) {
      const at = plain.indexOf(c.text.slice(0, 60));
      if (at < 0) continue;
      const before = plain.slice(Math.max(0, at - 90), at);
      const nearest = wordsList.map((w) => ({ w, i: before.lastIndexOf(w) })).filter((x) => x.i >= 0).sort((a, b) => b.i - a.i)[0];
      if (nearest?.w !== STATUS_WORD[c.kind]) fail(file, `the statement "${c.id}" is shown with ${nearest ? `"${nearest.w}"` : "no status word"} and its status is "${STATUS_WORD[c.kind]}"`);
    }
  }
  // self-test: a false sentence put into each page's own prose, one page at a time, must be flagged. a page or a region that
  // the scan skips would pass this silently, so the build proves the scan reaches every page
  const POSITIVE = "<p>Our first hubs already light the keys on players' pianos at home.</p>";
  for (const [file, text] of html) {
    const planted = text.replace(/(<main[^>]*>)/, `$1${POSITIVE}`);
    if (planted === text) { fail(file, "the guard self-test could not plant a sentence: the page has no main element"); continue; }
    if (hardwareProblems(route(file), proseSentences(planted)).length === 0) fail(file, "the hardware guard does not see a false sentence planted in this page");
  }
  // the not-found page is not listed, so it carries no canonical address
  if (/rel="canonical"/.test(page("/404.html"))) problems.push("/404.html: carries a canonical address for a page that does not exist");
  // the feed: every entry has its own id and an updated time that is its release date
  const feed = readFileSync(join(DIST, "changelog.xml"), "utf8");
  const ids = [...feed.matchAll(/<entry>[\s\S]*?<id>([^<]+)<\/id>/g)].map((m) => m[1] ?? "");
  if (new Set(ids).size !== ids.length) problems.push("changelog.xml: two entries share an id");
  if (/#r\d+/.test(feed)) problems.push("changelog.xml: an address built from a position in the list, which changes when a release is added");
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) in dist:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`checked ${html.size} pages${linksOnly ? " (links only)" : ""}${production ? " for production" : ""}: no problems`);
