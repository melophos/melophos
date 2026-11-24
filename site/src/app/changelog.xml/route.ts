import { FEED_STARTED } from "../../data/changelog.config.ts";
import { releases } from "../../lib/changelog.ts";
import { SITE_URL } from "../../site.config.ts";

export const dynamic = "force-static";

const escape = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// only released versions are in the feed. the unreleased section changes with every commit and has no date, so a
// reader would be told about an entry that then changes under it. each entry has an id that never changes and the
// time of its own release
export function GET() {
  const released = releases().filter((r) => r.iso !== null);
  const newest = released.map((r) => r.iso ?? "").sort().at(-1) ?? FEED_STARTED;
  const updated = `${newest}T00:00:00Z`;
  const entries = released
    .map(
      (r) => `  <entry>
    <title>${escape(`${r.title}, ${r.date}`)}</title>
    <id>${SITE_URL}/changelog/#${escape(r.slug)}</id>
    <link href="${SITE_URL}/changelog/#${escape(r.slug)}"/>
    <updated>${r.iso}T00:00:00Z</updated>
    <content type="html">${escape(r.html)}</content>
  </entry>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-GB">
  <title>MELOPHOS changelog</title>
  <id>${SITE_URL}/changelog/</id>
  <link href="${SITE_URL}/changelog/"/>
  <link rel="self" href="${SITE_URL}/changelog.xml"/>
  <updated>${updated}</updated>
${entries}
</feed>
`;
  return new Response(xml, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
