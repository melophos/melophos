import { allDocs } from "../../lib/docs.ts";
import { PAGES } from "../../lib/pages.ts";
import { SITE_URL } from "../../site.config.ts";

export const dynamic = "force-static";

// the sitemap protocol asks for every address to be entity-escaped, so a character with a meaning in XML stays text
const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function GET() {
  const urls = [...PAGES, ...allDocs().map((d) => d.route)];
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(`${SITE_URL}${u}`)}</loc></url>`).join("\n")}
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
