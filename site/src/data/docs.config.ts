// which of the repository's documents the site publishes. a document that still states something the
// repository does not do is withheld here with the reason. The site's own page covers the subject.
// tests/claims.test.ts also scans every published page for phrases known to be untrue, so removing a
// document from this list without correcting it fails the build.

export const WITHHELD: Record<string, string> = {
  "roadmap.md": "The Roadmap page shows this file with a status word on every item, so the document page would repeat it",
  "self-hosting.md": "Quotes memory needs that have not been measured",
  "inventory.md": "A list of parts one person has on a bench. It is not part of the project's public record",
};

// a document that has a page of its own on the site, so links to it go there
export const OWN_PAGE: Record<string, string> = { "docs/roadmap.md": "/roadmap/" };

// the order in the index follows docs/README.md. these are the groups it uses
export const EDIT_BRANCH_PATH = "docs";

// phrases that were true of an older draft and are not true now. no published page may contain one
export const STALE_PHRASES: string[] = [
  "Wrong notes flash red",
  "progress anyone can see",
  "Light-guided learning works",
  "prove it, but",
  "streaks, per-key heatmaps",
  "Good for piano and clean recordings",
  "2 GB of RAM for the core stack",
  "A new profile is the easiest",
  "Sponsored order",
  // the lights are described as above the keys everywhere. no other word for where they sit
  "behind the keys",
  "over the keys",
  // the colour tables now agree, so no page may say they differ
  "an older colour table",
  "still lights a guide as blue",
  // the scoring engine is being redesigned: no page may say that every press is judged right or wrong
  "every press is judged",
  "judged right or wrong",
  "either right or wrong",
  "every note is judged right",
];
