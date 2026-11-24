import { describe, expect, it } from "vitest";
import { PLACEHOLDER_MARKER } from "../src/site.config.ts";
import { allDocs } from "../src/lib/docs.ts";
import { roadmap } from "../src/lib/roadmap.ts";
import { readRoot } from "./lib/files.ts";

describe("community server privacy", () => {
  const doc = readRoot("docs/community-privacy.md");
  it("is published and linked from the privacy page and the Discord welcome text", () => {
    expect(allDocs().some((d) => d.slug === "community-privacy")).toBe(true);
    expect(readRoot("site/src/app/privacy/page.tsx")).toContain("/docs/community-privacy/");
    expect(readRoot("discord/texts/start-3.md")).toContain("docs/community-privacy.md");
  });
  it("keeps the facts the privacy page also states", () => {
    expect(doc).toContain("12 months");
    expect(readRoot("site/src/app/privacy/page.tsx")).toContain("12 months");
    expect(doc).toContain("Discord");
  });
  it("names the person responsible and gives no postal address", () => {
    expect(doc).not.toContain(PLACEHOLDER_MARKER);
    expect(doc).toContain("We do not give a postal address");
    expect(doc).toContain("Legal person responsible");
  });
  it("matches what the bot is configured to hold", () => {
    expect(readRoot("discord/README.md")).toContain("leave all three privileged intents off");
    expect(readRoot("discord/README.md")).toContain("purge-mod-log --older-than 365d");
  });
});

describe("the roadmap statuses", () => {
  const { versions } = roadmap();
  const items = versions.flatMap((v) => v.groups.flatMap((g) => g.items));
  it("uses the host-tested word only for hub firmware", () => {
    const host = versions.flatMap((v) => v.groups.filter((g) => g.items.some((i) => i.status === "host")).map((g) => g.name));
    expect(new Set(host)).toEqual(new Set(["Firmware"]));
  });
  it("claims nothing built for hardware", () => {
    const hw = versions[1]?.groups.find((g) => g.name === "Hardware");
    expect(hw?.items.length).toBeGreaterThan(3);
    expect(hw?.items.some((i) => i.status === "built" || i.status === "host")).toBe(false);
  });
  it("has items in every status it uses", () => {
    expect(items.length).toBeGreaterThan(20);
  });
});
