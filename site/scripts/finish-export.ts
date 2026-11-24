// runs after next build. the export is plain files, but the framework writes its page data as inline scripts. the
// content security policy allows only the site's own files, so each inline script becomes a file of its own beside the
// page, named by its hash and loaded in the same place and order. it also adds the preload for the reading font and
// removes the data files that only client-side navigation would read, which this site does not use.
// usage: node scripts/finish-export.ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = join(process.cwd(), "out");
const INLINE_DIR = "_next/static/inline";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(OUT);

// the reading font: its hashed address is in the bundled stylesheet
const css = files.filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n");
const font = /url\(([^)]*AtkinsonHyperlegibleNext-Variable[^)]*\.woff2)\)/.exec(css)?.[1]?.replace(/^["']|["']$/g, "");
if (!font) throw new Error("the reading font is not in the stylesheet: the preload cannot be added");
const fontUrl = font.startsWith("/") ? font : `/_next/static/media/${font.split("/").at(-1)}`;

mkdirSync(join(OUT, INLINE_DIR), { recursive: true });
let moved = 0;
for (const file of files.filter((f) => f.endsWith(".html"))) {
  let html = readFileSync(file, "utf8");
  // a script with no src attribute and no data type is code. a JSON-LD block is data and is left where it is. the
  // pass repeats until nothing changes, so no inline script is left for the content security policy to block, even
  // one that only appears once another has been moved
  const inline = /<script(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")([^>]*)>([\s\S]*?)<\/script>/g;
  for (let before = ""; before !== html; ) {
    before = html;
    html = html.replace(inline, (_all, attrs: string, code: string) => {
      if (code.trim() === "") return "";
      const hash = createHash("sha256").update(code).digest("hex").slice(0, 20);
      writeFileSync(join(OUT, INLINE_DIR, `${hash}.js`), code);
      moved += 1;
      return `<script${attrs} src="/${INLINE_DIR}/${hash}.js"></script>`;
    });
  }
  html = html.replace("</head>", `<link rel="preload" href="${fontUrl}" as="font" type="font/woff2" crossorigin=""/></head>`);
  writeFileSync(file, html);
}

// the data files for client-side navigation. every link on the site is a plain link, so nothing reads them
let removed = 0;
for (const file of files.filter((f) => f.endsWith(".txt"))) {
  const name = relative(OUT, file);
  if (/(^|\/)(index|__next[^/]*)\.txt$/.test(name) || /^\d+:/.test(readFileSync(file, "utf8").slice(0, 8))) {
    if (name === "robots.txt" || name === "llms.txt" || name.startsWith("fonts/")) continue;
    rmSync(file);
    removed += 1;
  }
}

// the framework also writes the not-found page under two other addresses. the host serves 404.html with a 404 status
for (const dir of ["_not-found", "404"]) rmSync(join(OUT, dir), { recursive: true, force: true });

console.log(`finished the export: ${moved} inline scripts moved to files, ${removed} navigation data files removed, font preload ${fontUrl}`);
