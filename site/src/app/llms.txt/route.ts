// a plain text map of the site for language tools, in the llms.txt form: what the project is, then each page with one
// line. it is built from the same page list and documents as the sitemap, so it cannot fall behind
import { allDocs } from "../../lib/docs.ts";
import { SITE_URL } from "../../site.config.ts";

export const dynamic = "force-static";

const PAGES: [string, string, string][] = [
  ["/", "Home", "What MELOPHOS is, who it is for, what is built today and common questions"],
  ["/how-it-works/", "How it works", "The instrument, the hub, the Studio and the server, each with its status"],
  ["/hardware/", "Hardware", "The draft hub design, the bill of materials and the power limits. The boards are still in the works and none has been made"],
  ["/accessibility/", "Accessibility", "What is built and planned for access and the accessibility statement"],
  ["/roadmap/", "Roadmap", "What is built and planned, version by version, with the status words"],
  ["/docs/", "Documentation", "The project's documents"],
  ["/changelog/", "Changelog", "Notable changes, release by release"],
  ["/about/", "About", "Why the project exists and the founder's note"],
  ["/contact/", "Contact", "Where to send questions, bugs, security reports and anything else"],
  ["/privacy/", "Privacy", "What the site, the Studio and the community server store and send"],
  ["/cookies/", "Cookies and storage", "The one value the site keeps and what the Studio keeps on the device"],
  ["/terms/", "Terms of use", "The terms for the site and the Studio"],
  ["/licences/", "Licences", "The project licences and the packages the site is built with"],
];

export function GET() {
  const docs = allDocs();
  const text = `# MELOPHOS

> An open source system for learning the piano with light. The Studio, a practice app in the browser, is built. The hub with LED bars above the keys is fully designed and waits to be made. No board has been made yet.

## Pages

${PAGES.map(([path, name, what]) => `- [${name}](${SITE_URL}${path}): ${what}`).join("\n")}

## Documents

${docs.map((d) => `- [${d.title}](${SITE_URL}${d.route})${d.summary ? `: ${d.summary}` : ""}`).join("\n")}
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
