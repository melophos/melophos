// no private name, personal link or false hardware sentence in anything the site publishes: the built pages (checked by
// verify-dist.ts), every published document, the published part of the changelog and the site's own source.
import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWED, hardwareProblems, privateProblems } from "../src/lib/guards.ts";
import { hashOf } from "../src/lib/hashed-names.ts";
import { allDocs } from "../src/lib/docs.ts";
import { intro, releases } from "../src/lib/changelog.ts";
import { STATUS_WORD } from "../src/data/status.ts";
import { roadmap } from "../src/lib/roadmap.ts";
import { readRoot, readSite, walk } from "./lib/files.ts";

describe("private names and personal links", () => {
  for (const doc of allDocs()) {
    it(`${doc.file} names none`, () => expect(privateProblems(readRoot(doc.file))).toEqual([]));
  }
  it("the published changelog names none", () => {
    expect(privateProblems(intro() + releases().map((r) => r.html).join(""))).toEqual([]);
  });
  it("the pages' source and data name none", () => {
    for (const f of [...walk("src/app"), ...walk("src/data"), "README.md"].filter((p) => !p.endsWith("changelog.config.ts"))) expect(privateProblems(readSite(f)), f).toEqual([]);
  });
  it("the guard itself catches each kind", () => {
    const p = (s: string): number => privateProblems(s).length;
    // a stand-in name, hashed here, shows the hashed check works without writing a real name into the test
    const stand = new Set([hashOf("wobblecart")]);
    expect(privateProblems("see https://github.com/wobblecart/notes", stand)).toEqual(['a private name: "wobblecart"']);
    expect(privateProblems("nothing to see here", stand)).toEqual([]);
    expect(p(["me", "@", "gm", "ail.com"].join(""))).toBe(1);
    expect(p(["linkedin.com/", "in/", "someone"].join(""))).toBe(1);
    expect(p("https://linkedin.com/company/melophos")).toBe(0);
  });
});

describe("sentences that say hardware exists", () => {
  for (const doc of allDocs()) {
    it(`${doc.file} says nothing that is false while no board exists`, () => expect(hardwareProblems(doc.route, readRoot(doc.file))).toEqual([]));
  }
  it("the guard catches the phrases and lets the listed plans through", () => {
    for (const bad of ["it has been tested on a real board", "the hub ships in March", "kits in stock", "order now", "works on real hardware"]) {
      expect(hardwareProblems("/", bad).length, bad).toBeGreaterThan(0);
    }
    expect(hardwareProblems("/", "A rhythm game mode")).toEqual([]);
    for (const a of HARDWARE_ALLOWED) expect(hardwareProblems(a.where, a.phrase)).toEqual([]);
    expect(hardwareProblems("/hardware/", "Our first hubs already light the keys on players' pianos at home.")).not.toEqual([]);
    expect(hardwareProblems("/", "The hub is designed to light the next key.")).toEqual([]);
    expect(hardwareProblems("/", "The LED bars now work on every piano.")).not.toEqual([]);
    expect(hardwareProblems("/", "A hub board has been made and tested.")).not.toEqual([]);
  });
  it("every allowed phrase is still in the document it is allowed in", () => {
    const text = readRoot("docs/roadmap.md");
    for (const a of HARDWARE_ALLOWED.filter((x) => x.where.startsWith("/docs/"))) expect(text, a.phrase).toContain(a.phrase);
  });
});

describe("status words", () => {
  it("the list is exactly these seven", () => {
    expect(Object.values(STATUS_WORD)).toEqual(["Built", "Host-tested, awaits a board", "Partly built", "In progress", "Designed, not yet made", "Planned", "Not yet checked"]);
  });
  it("no roadmap item ends with a status of its own", () => {
    const text = readRoot("docs/roadmap.md");
    for (const line of text.split("\n").filter((l) => l.startsWith("- ["))) {
      const note = /\(([^)]*)\)\s*$/.exec(line)?.[1]?.toLowerCase();
      if (note) expect(note, line).not.toMatch(/^(done|wip|beta|partly|partial|experimental|complete|finished|stub|working)\b/);
    }
    expect(roadmap().versions.length).toBeGreaterThan(2);
  });
});
