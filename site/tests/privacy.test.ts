// the privacy page is true only while these hold: what the site stores, what it sets, what the hosting must leave off and
// that the page's Studio sentences are the ones the Studio's code checks back.
import { describe, expect, it } from "vitest";
import { readSite, readRoot, walk } from "./lib/files.ts";
import { STUDIO_CLAIMS } from "../src/data/studio-state.ts";
import { PLACEHOLDERS } from "../src/site.config.ts";

const page = readSite("src/app/privacy/page.tsx");
const sources = [...walk("src"), ...walk("public")].filter((p) => /\.(ts|tsx|js|css)$/.test(p));

describe("what the site stores", () => {
  it("writes one local storage key and only the theme", () => {
    const keys = new Set<string>();
    for (const f of sources) for (const m of readSite(f).matchAll(/localStorage\.setItem\(\s*([^,)]+)/g)) keys.add(`${m[1]?.trim()}`);
    expect([...keys]).toEqual(["KEY"]);
    expect(readSite("src/client/theme.ts")).toContain('const KEY = "melophos-theme"');
  });
  it("sets no cookie and keeps nothing in session storage or a database", () => {
    for (const f of sources.filter((p) => !p.startsWith("src/data/") && !p.startsWith("src/lib/"))) {
      const text = readSite(f);
      expect(text, f).not.toMatch(/document\.cookie|sessionStorage|indexedDB|navigator\.sendBeacon/);
    }
  });
  it("loads nothing from another origin: the policy allows only its own and no connection", () => {
    const headers = readSite("public/_headers");
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).not.toMatch(/https?:\/\/(?!app\.melophos)/);
  });
});

describe("the page and the Studio", () => {
  it("states the Studio sentences that the Studio's code checks", () => {
    for (const id of ["stores-in-browser", "offline", "network", "own-server", "spoken-voice"]) {
      expect(page, `privacy/page.tsx does not use the ${id} statement`).toContain(`studioClaim("${id}")`);
      expect(STUDIO_CLAIMS.some((c) => c.id === id), id).toBe(true);
    }
  });
  it("does not open by saying nothing is collected", () => {
    expect(page).not.toMatch(/do not collect anything|nothing is collected|hold no personal data/i);
  });
  it("names the Discord log with its 12 months, the email retention and the host", () => {
    expect(page).toContain("12 months");
    expect(page).toContain("as long as the conversation needs");
    expect(page).toContain("Cloudflare");
    expect(readRoot("docs/community-privacy.md")).toContain("12 months");
  });
  it("lists the legal person and the studio host as owner placeholders and gives no postal address", () => {
    expect(page).toContain('placeholder("legalPerson")');
    expect(page).not.toContain('placeholder("postalAddress")');
    expect(page).toContain('placeholder("studioHost")');
    expect(Object.keys(PLACEHOLDERS).sort()).toEqual(["governingLaw", "legalPerson", "studioHost"]);
  });
});

describe("the hosting settings that keep the page true", () => {
  const readme = readSite("README.md").replace(/\s+/g, " ");
  it("are written down in the site's README with a check to run on the live domain", () => {
    expect(readme).toContain("## Hosting settings that keep the privacy page true");
    for (const word of ["Email Address Obfuscation", "Web Analytics", "Zaraz", "email-decode"]) expect(readme, word).toContain(word);
    expect(readme).toContain("npm run check:live");
    expect(readme).toContain("do not announce the site until it passes");
    expect(readme).toContain("The guards are a net and not a proof");
    expect(readme).toContain("A person reads every page against the status page");
  });
  it("have a live check that reads the response for each", () => {
    const script = readSite("scripts/check-live.ts");
    for (const word of ["email-decode", "cloudflareinsights", "zaraz", "cf-email"]) expect(script, word).toContain(word);
  });
});

describe("one claim carries one status on every page", () => {
  it("every Studio statement shown on a page is shown with its own status", () => {
    for (const f of walk("src/app").filter((p) => p.endsWith(".tsx"))) {
      const text = readSite(f);
      for (const m of text.matchAll(/studioClaim\("([a-z-]+)"\)\.text/g)) {
        const line = text.split("\n").find((l) => l.includes(m[0])) ?? "";
        expect(line, `${f}: ${m[1]} is shown without its status`).toContain(`<Status status={studioClaim("${m[1]}").kind} />`);
      }
    }
    // the accessibility page lists every claim with the claim's own kind. No page writes a status next to a claim by hand
    const acc = readSite("src/app/accessibility/page.tsx");
    expect(acc).toContain("<Status status={c.kind} />");
    expect(acc).toContain("<Status status=\"built\" />");
  });
  it("the network statement is worded as what the Studio is built to do and is not yet checked", () => {
    const c = STUDIO_CLAIMS.find((x) => x.id === "network");
    // it was unchecked until the Studio wrote its behaviour test, which the claim now names
    expect(c?.checks.some((k) => "test" in k && k.test.title === "the Studio requests nothing but the saved server address")).toBe(true);
    expect(c?.kind).toBe("built");
    expect(c?.text).toMatch(/is built to/);
    expect(c?.text).not.toMatch(/^The Studio sends nothing/);
  });
});
