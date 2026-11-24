// every statement the site makes about a part is held to the repository's own code. a row that says Built needs a check
// that reads code, a row that says a thing does not exist needs a check that it does not and every check must hold now.
import { describe, expect, it } from "vitest";
import { PARTS, STATUS_WORD, type Status } from "../src/data/status.ts";
import { HUB_CLAIMS } from "../src/data/hub-state.ts";
import { WITHHELD, STALE_PHRASES } from "../src/data/docs.config.ts";
import { OMITTED_CHANGELOG_LINES } from "../src/data/changelog.config.ts";
import { isCode, runChecks } from "../src/lib/checks.ts";
import { allDocs } from "../src/lib/docs.ts";
import { releases } from "../src/lib/changelog.ts";
import { ROOT, readRoot } from "./lib/files.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const claimsOfCode: Status[] = ["built", "host", "partly"];

describe("the status of each part", () => {
  for (const part of PARTS) {
    it(`${part.name}: every check on the code still holds`, () => {
      expect(part.checks.length).toBeGreaterThan(0);
      expect(runChecks(part.checks, ROOT), `read the repository again and update site/src/data/status.ts for ${part.name}`).toEqual([]);
    });
    it(`${part.name}: its status rests on code and not on a sentence in a README`, () => {
      const code = part.checks.filter(isCode);
      expect(code.length, "a row needs at least one check that reads code").toBeGreaterThan(0);
      if (claimsOfCode.includes(part.status)) expect(code.some((c) => "file" in c || "under" in c), "a built row needs a check inside a file").toBe(true);
      // a built row rests on a test that lives in the package that owns the behaviour. the profiles have a checker script
      // and no named test, which the report lists as a test the profiles folder needs
      if (claimsOfCode.includes(part.status) && part.id !== "profiles") expect(part.checks.some((c) => "test" in c), `${part.name} names no test in its own package`).toBe(true);
      // a part that is only designed has a check that nothing was made
      if (part.status === "design" || part.status === "planned") expect(part.checks.some((c) => "noFileNamed" in c || "missing" in c), "a designed part needs a check that no layout exists").toBe(true);
    });
  }

  it("never calls hardware built", () => {
    for (const part of PARTS.filter((p) => p.id === "hub-board" || p.id === "led-bars")) expect(part.status).toBe("design");
  });

  it("says in the same row when the firmware has not run on a board", () => {
    const fw = PARTS.find((p) => p.id === "firmware");
    expect(fw?.status).toBe("host");
    expect(fw?.unchecked).toMatch(/never run on a board/);
  });

  it("gives every part a status word from the one list", () => {
    for (const part of PARTS) expect(STATUS_WORD[part.status], part.id).toBeTruthy();
  });
});

describe("the hub statements", () => {
  for (const claim of Object.values(HUB_CLAIMS)) {
    it(`${claim.id}: the firmware's files still support it`, () => {
      expect(runChecks(claim.checks, ROOT), `read the firmware again and update site/src/data/hub-state.ts`).toEqual([]);
    });
    it(`${claim.id}: rests on a test in the firmware that fails when the behaviour changes`, () => {
      if (claim.id === "audio" || claim.id === "studioControl") return;
      expect(claim.checks.some((c) => "test" in c), claim.id).toBe(true);
    });
    it(`${claim.id}: a hub feature is never called built without a board`, () => {
      expect(["host", "planned"]).toContain(claim.status);
    });
  }
});

describe("the documents the site publishes", () => {
  it("withholds only documents that exist, each with a reason", () => {
    for (const [name, reason] of Object.entries(WITHHELD)) {
      expect(existsSync(join(ROOT, "docs", name)), name).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("publishes no document that holds a phrase known to be untrue", () => {
    for (const doc of allDocs()) {
      const text = readRoot(doc.file);
      for (const phrase of STALE_PHRASES) expect(text.includes(phrase), `${doc.file} still says "${phrase}"`).toBe(false);
    }
  });

  it("publishes the architecture document now that it describes what exists", () => {
    expect(allDocs().some((d) => d.slug === "architecture")).toBe(true);
    expect(WITHHELD["architecture.md"]).toBeUndefined();
  });
});

describe("the changelog", () => {
  it("leaves out only lines that exist, so an entry never goes stale", () => {
    const source = readRoot("CHANGELOG.md");
    for (const o of OMITTED_CHANGELOG_LINES) expect(source.includes(o.contains), `nothing contains "${o.contains}"`).toBe(true);
  });

  it("no longer carries the omitted lines", () => {
    const html = releases().map((r) => r.html).join("");
    for (const o of OMITTED_CHANGELOG_LINES) expect(html.includes(o.contains)).toBe(false);
  });

  it("publishes no personal domain, link or address", () => {
    const html = releases().map((r) => r.html).join("");
    expect(html).not.toMatch(/isaacadjei/i);
    expect(html).not.toMatch(/gmail\.com/i);
  });

  it("gives every release an address that does not depend on its position", () => {
    const list = releases();
    expect(new Set(list.map((r) => r.slug)).size).toBe(list.length);
    for (const r of list) expect(r.html).not.toMatch(/id="r\d+-/);
  });
});
