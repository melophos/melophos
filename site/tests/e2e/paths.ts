// every page the checks open: the pages of the sitemap, read from the built site
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sitemap = readFileSync(join(process.cwd(), "out/sitemap.xml"), "utf8").toString();
export const PATHS: string[] = [...sitemap.matchAll(/<loc>https:\/\/melophos\.com([^<]*)<\/loc>/g)].map((m) => m[1] ?? "/").concat(["/404.html"]);
