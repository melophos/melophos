// the third-party list, generated at build time from the packages the site is built with.
// none of these packages is sent to a visitor: the pages are plain HTML and CSS with two small scripts of our own.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as checker from "license-checker-rseidelsohn";

export interface Pkg {
  name: string;
  version: string;
  licence: string;
}

export async function packages(): Promise<Pkg[]> {
  const found = await new Promise<Record<string, { licenses?: string | string[] | undefined }>>((resolve, reject) => {
    checker.init({ start: process.cwd(), excludePrivatePackages: true }, (err: Error | undefined, result: Record<string, { licenses?: string | string[] | undefined }>) =>
      err ? reject(err) : resolve(result),
    );
  });
  return Object.entries(found)
    .map(([key, info]) => {
      const at = key.lastIndexOf("@");
      const licence = Array.isArray(info.licenses) ? info.licenses.join(" AND ") : (info.licenses ?? "UNKNOWN");
      return { name: key.slice(0, at), version: key.slice(at + 1), licence };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function directNames(): string[] {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();
}
