import { describe, expect, it } from "vitest";
import { PLACEHOLDERS, PLACEHOLDER_MARKER, placeholder, unfilledPlaceholders } from "../src/site.config.ts";
import { readRoot, readSite } from "./lib/files.ts";

describe("owner placeholders", () => {
  it("read as a marked sentence until the owner fills them", () => {
    for (const p of unfilledPlaceholders()) expect(placeholder(p.id as keyof typeof PLACEHOLDERS)).toContain(PLACEHOLDER_MARKER);
  });
  it("say what is needed", () => {
    for (const p of Object.values(PLACEHOLDERS)) expect(p.what.length).toBeGreaterThan(10);
  });
  it("name the pages that must show them", () => {
    for (const p of Object.values(PLACEHOLDERS)) expect(p.pages.length, p.id).toBeGreaterThan(0);
  });
  it("are in every document that carries the same marker, word for word", () => {
    for (const p of Object.values(PLACEHOLDERS)) for (const d of p.docs) expect(readRoot(d.file), `${d.file} lost the ${p.id} row`).toContain(d.text);
  });
  it("appear on the privacy page through the one function, so the production build can find them", () => {
    const page = readSite("src/app/privacy/page.tsx");
    for (const p of Object.values(PLACEHOLDERS).filter((p) => p.pages.includes("/privacy/"))) expect(page, p.id).toContain(`placeholder("${p.id}")`);
  });
  it("leave no marker in a document that no placeholder lists", () => {
    const doc = readRoot("docs/community-privacy.md");
    const listed = Object.values(PLACEHOLDERS).flatMap((p) => p.docs.map((d) => d.text));
    for (const m of doc.matchAll(/\[OWNER TO SUPPLY:[^\]]*\]/g)) expect(listed, m[0]).toContain(m[0]);
  });
});
