import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Kind, SourceFile } from "./rules.ts";

// the studio folder, whatever the working directory is
export const ROOT = new URL("../../", import.meta.url).pathname;

export const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      out.push(...walk(rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const KINDS: Record<string, Kind> = { ".css": "css", ".ts": "ts", ".tsx": "ts", ".html": "html", ".json": "json" };

// the product source the rules scan: everything under src and the two html pages, never a test
export function sourceFiles(): SourceFile[] {
  const paths = [
    ...walk("src").filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".json") && !p.includes("/fonts/")),
    "index.html",
    "specimen.html",
    "package.json",
  ];
  return paths.flatMap((path) => {
    const kind = KINDS[path.slice(path.lastIndexOf("."))];
    return kind ? [{ path, kind, text: read(path) }] : [];
  });
}
