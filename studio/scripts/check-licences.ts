// licence check (section 3.11): every package in the npm tree must carry a licence from the allowed list.
// run with: npm run check:licences
// anything else fails the build. an exception needs an entry in scripts/licences.allow.json with a reason.

import { readFileSync } from "node:fs";
import * as checker from "license-checker-rseidelsohn";

// the licences the specification lists, in SPDX form. OFL-1.1 covers the bundled fonts
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "MPL-2.0", "Unlicense", "OFL-1.1"]);

interface Exception {
  package: string;
  licence: string;
  reason: string;
}

const root = new URL("../", import.meta.url).pathname;
const exceptions = JSON.parse(readFileSync(new URL("./licences.allow.json", import.meta.url), "utf8")) as Exception[];

// "(MIT OR Apache-2.0)" passes when any alternative is allowed. "MIT AND X" needs every part allowed
function acceptable(expression: string): boolean {
  const cleaned = expression.replace(/[()*]/g, " ").trim();
  return cleaned.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((part) => ALLOWED.has(part.trim())));
}

const found = await new Promise<Record<string, { licenses?: string | string[] | undefined }>>((resolve, reject) => {
  checker.init({ start: root, excludePrivatePackages: true }, (err: Error | undefined, packages: Record<string, { licenses?: string | string[] | undefined }>) =>
    err ? reject(err) : resolve(packages),
  );
});

const failures: string[] = [];
const used = new Set<string>();
let count = 0;
for (const [name, info] of Object.entries(found)) {
  count++;
  const licence = Array.isArray(info.licenses) ? info.licenses.join(" AND ") : (info.licenses ?? "UNKNOWN");
  if (acceptable(licence)) continue;
  const exception = exceptions.find((e) => name.startsWith(`${e.package}@`) && e.licence === licence);
  if (exception) {
    used.add(exception.package);
    continue;
  }
  failures.push(`${name}: ${licence}`);
}

const stale = exceptions.filter((e) => !used.has(e.package)).map((e) => `${e.package} (${e.licence})`);
console.log(`checked ${count} packages against ${[...ALLOWED].join(", ")}`);
if (exceptions.length > 0) console.log(`exceptions in use: ${[...used].join(", ") || "none"}`);
if (stale.length > 0) failures.push(`allow-list entries that match nothing: ${stale.join(", ")}`);
if (failures.length > 0) {
  console.error(`\nlicences outside the list:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("all licences are on the list");
