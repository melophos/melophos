import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SITE = process.cwd();
export const ROOT = join(SITE, "..");
export const readSite = (p: string): string => readFileSync(join(SITE, p), "utf8");
export const readRoot = (p: string): string => readFileSync(join(ROOT, p), "utf8");

export function walk(dir: string): string[] {
  return readdirSync(join(SITE, dir)).flatMap((n) => {
    const rel = join(dir, n);
    return statSync(join(SITE, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
