// reads the monorepo the site is built from. the site never keeps a copy of a document, a table or a token:
// it reads the file at build time, so there is one copy of each fact.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative, dirname, sep } from "node:path";

// the build runs from site/, so the monorepo root is one level up
export const ROOT = resolve(process.cwd(), "..");

if (!existsSync(join(ROOT, "docs")) || !existsSync(join(ROOT, "studio"))) {
  throw new Error("site/ builds inside the monorepo: run it from the site folder with the other folders beside it");
}

// the site builds from this repository alone. a path that leaves it (a sibling checkout, a private journal) is an
// error, so a build or a test can never depend on another folder on one person's machine
export function inRepo(path: string): string {
  const full = resolve(ROOT, path);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) throw new Error(`${path} is outside this repository`);
  return full;
}

export const readRepo = (path: string): string => readFileSync(inRepo(path), "utf8");
export const repoExists = (path: string): boolean => existsSync(inRepo(path));
export const isDirectory = (path: string): boolean => repoExists(path) && statSync(inRepo(path)).isDirectory();

// a path written inside one repository file, as a path from the repository root
export function resolveFrom(file: string, target: string): string {
  return relative(ROOT, resolve(ROOT, dirname(file), target)).split("\\").join("/");
}
