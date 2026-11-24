// the present tense guard must not flag a true sentence: the people who write the documents would be stopped by a false flag.
// the true negatives are taken from the real documents (musical bars, thresholds, test units, budget statements about the
// design). the true positives are the kind of sentence that would be false while no board exists.
import { describe, expect, it } from "vitest";
import { presentTenseFlags } from "../src/lib/guards.ts";
import { allDocs } from "../src/lib/docs.ts";
import { readRoot } from "./lib/files.ts";

const TRUE_NEGATIVES = [
  "The families include each hand alone with a late note, a hesitation, a rush and a sudden change of tempo.",
  "A restart at bar 12 is read as a jump back to the first bar of the piece.",
  "Two bars of silence end the phrase and the reading starts again.",
  "We set a bar of 0.95 for agreement and a family that falls below the bar is listed as a limit.",
  "The weights were set so that no family misses its bar by more than two points.",
  "A unit test presses wrong keys at eight different rates and checks the flash count.",
  "The work for one press is counted in units and the bound is 41 476 units at the defaults.",
  "The board's budget supports 2.70 A of LEDs on a 5 A supply.",
  "The Studio shows the next bar on the practice view and the loop runs from bar 3 to bar 5.",
  "Rhythm mode runs a one bar count-in before the first note.",
  "The server runs with one Docker Compose command.",
  "The Studio works offline after the first load.",
  "The worker runs slow jobs away from the request path.",
  "The firmware reads the keyboard through the MIDI jack and the code is tested on a computer.",
  "The hub is designed to light the next key.",
  "The hub waits to be claimed by its owner before it can publish.",
  "The octave bar is designed to carry 12 lights at real key spacing.",
  "No hub has been made yet, so no real bar looks like this yet.",
];

const TRUE_POSITIVES = [
  "Our first hubs already light the keys on players' pianos at home.",
  "The hub lights the next key on a real piano.",
  "The LED bars now work on every piano.",
  "A hub board has been made and tested.",
  "The octave bars light every key of an 88 key keyboard.",
  "Our kits are in homes already.",
  "The prototype runs at home.",
];

describe("the present tense guard", () => {
  for (const s of TRUE_NEGATIVES) it(`lets a true sentence through: ${s.slice(0, 60)}`, () => expect(presentTenseFlags(s)).toEqual([]));
  for (const s of TRUE_POSITIVES) it(`flags a sentence that would be false: ${s.slice(0, 60)}`, () => expect(presentTenseFlags(s).length).toBeGreaterThan(0));

  it("says why: the word that matched and the whole sentence", () => {
    const f = presentTenseFlags("Our first hubs already light the keys on players' pianos at home.")[0];
    expect(f?.subject).toMatch(/hubs/);
    expect(f?.verb.length).toBeGreaterThan(0);
    expect(f?.sentence).toContain("players' pianos");
  });

  it("flags nothing in any published document as it is now", () => {
    for (const doc of allDocs()) expect(presentTenseFlags(readRoot(doc.file)).map((f) => f.sentence), doc.file).toEqual([]);
  });
  it("flags nothing in the roadmap, the protocol, the scoring page or the firmware and Studio documents", () => {
    for (const f of ["docs/scoring.md", "docs/protocol.md", "docs/roadmap.md", "firmware/docs/practice-modes.md", "firmware/docs/pins-and-power.md", "studio/README.md", "core/README.md"]) {
      expect(presentTenseFlags(readRoot(f)).map((x) => x.sentence), f).toEqual([]);
    }
  });
});

describe("the scan reads sentences the way a visitor does", () => {
  it("a sentence is not joined to the heading or paragraph before it", async () => {
    const { proseSentences } = await import("../src/lib/words.ts");
    const { hardwareProblems } = await import("../src/lib/guards.ts");
    const html = `<main><h1>About MELOPHOS</h1><p>An open source system for learning an instrument with light and the way to take part</p><p>Our first hubs already light the keys on players&#39; pianos at home.</p></main>`;
    expect(hardwareProblems("/about/", proseSentences(html)).length).toBeGreaterThan(0);
  });
  it("only the signed founder's note is left out, as a marked region", async () => {
    const { proseSentences } = await import("../src/lib/words.ts");
    const { hardwareProblems } = await import("../src/lib/guards.ts");
    const note = `<figure class="note-signed"><blockquote><p>The hubs already light my keys at home.</p></blockquote></figure>`;
    expect(hardwareProblems("/about/", proseSentences(`<main>${note}</main>`))).toEqual([]);
    expect(hardwareProblems("/about/", proseSentences(`<main>${note}<p>The hubs already light my keys at home.</p></main>`)).length).toBeGreaterThan(0);
  });
});
