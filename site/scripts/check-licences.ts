// licence check: every package in the site's npm tree must carry a licence from the list in section 3.11 of the
// specification. an exception needs an entry in scripts/licences.allow.json with a reason.
import { readFileSync } from "node:fs";
import * as checker from "license-checker-rseidelsohn";

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "MPL-2.0", "Unlicense", "OFL-1.1"]);
interface Exception {
  package: string;
  licence: string;
  reason: string;
  // a per-platform binary that npm installs on some machines only, so it may match nothing here
  optional?: boolean;
}
const exceptions = JSON.parse(readFileSync(new URL("./licences.allow.json", import.meta.url), "utf8")) as Exception[];

function acceptable(expression: string): boolean {
  const cleaned = expression.replace(/[()*]/g, " ").trim();
  return cleaned.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((part) => ALLOWED.has(part.trim())));
}

const found = await new Promise<Record<string, { licenses?: string | string[] | undefined }>>((resolve, reject) => {
  checker.init({ start: process.cwd(), excludePrivatePackages: true }, (err: Error | undefined, p: Record<string, { licenses?: string | string[] | undefined }>) =>
    err ? reject(err) : resolve(p),
  );
});

const failures: string[] = [];
const used = new Set<string>();
for (const [name, info] of Object.entries(found)) {
  const licence = Array.isArray(info.licenses) ? info.licenses.join(" AND ") : (info.licenses ?? "UNKNOWN");
  if (acceptable(licence)) continue;
  const ex = exceptions.find((e) => name.startsWith(`${e.package}@`) && e.licence === licence);
  if (ex) used.add(ex.package);
  else failures.push(`${name}: ${licence}`);
}
for (const e of exceptions) if (!e.optional && !used.has(e.package)) failures.push(`allow-list entry that matches nothing: ${e.package} (${e.licence})`);
console.log(`checked ${Object.keys(found).length} packages`);
if (failures.length > 0) {
  console.error(`\nlicences outside the list:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("all licences are on the list");
