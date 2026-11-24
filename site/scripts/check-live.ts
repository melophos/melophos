// run against the live address once it exists: node scripts/check-live.ts https://melophos.com
// it fetches every page of the sitemap and fails when the host has injected anything the privacy page says is absent:
// Cloudflare's email address rewriting (a cf-email marker, the email-decode script or the text "[email protected]"), Web
// Analytics (cloudflareinsights) or Zaraz and any tag manager. it also checks the security headers the site depends on.
// the host is the only thing this reads. it sends no data anywhere and stores nothing.

const origin = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) {
  console.error("usage: node scripts/check-live.ts https://melophos.com");
  process.exit(2);
}

const FORBIDDEN: { needle: RegExp; why: string }[] = [
  { needle: /cf-email|email-decode|__cf_email__|\[email.{0,3}protected\]/i, why: "Cloudflare Email Address Obfuscation is on: switch it off in Scrape Shield" },
  { needle: /cloudflareinsights|static\.cloudflareinsights|beacon\.min\.js/i, why: "Cloudflare Web Analytics is on: switch it off for this site" },
  { needle: /zaraz|\/cdn-cgi\/zaraz/i, why: "Zaraz is on: remove the Zaraz configuration from the zone" },
  { needle: /googletagmanager|google-analytics|gtag\(|plausible|matomo|segment\.com/i, why: "a tag manager or analytics script is in the page" },
];

const REQUIRED_HEADERS = ["content-security-policy", "strict-transport-security", "x-content-type-options", "referrer-policy", "permissions-policy"];

const problems: string[] = [];
const get = async (path: string): Promise<{ text: string; headers: Headers; status: number }> => {
  const r = await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  return { text: await r.text(), headers: r.headers, status: r.status };
};

const sitemap = await get("/sitemap.xml");
if (sitemap.status !== 200) problems.push(`/sitemap.xml answered ${sitemap.status}`);
const paths = [...sitemap.text.matchAll(/<loc>https:\/\/[^/<]+([^<]*)<\/loc>/g)].map((m) => m[1] ?? "/");
if (paths.length < 5) problems.push(`the sitemap lists only ${paths.length} pages`);

for (const path of [...new Set([...paths, "/404.html", "/changelog.xml"])]) {
  const page = await get(path);
  for (const f of FORBIDDEN) if (f.needle.test(page.text)) problems.push(`${path}: ${f.why}`);
  if (path === "/") for (const h of REQUIRED_HEADERS) if (!page.headers.get(h)) problems.push(`/: the ${h} header is missing`);
  if (path === "/" && /set-cookie/i.test([...page.headers.keys()].join(" "))) problems.push("/: the host sets a cookie");
}

// the address of the page that carries the email address must show it as text, which is what a visitor with scripts off sees
const privacy = await get("/privacy/");
if (!privacy.text.includes("contact@melophos.com")) problems.push("/privacy/: the contact address is not in the page as plain text");

if (problems.length > 0) {
  console.error(`${problems.length} problem(s) on ${origin}:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`${origin}: ${paths.length} pages checked, nothing injected and the headers are present`);
