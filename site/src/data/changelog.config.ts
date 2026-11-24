// lines of CHANGELOG.md that the public changelog leaves out, each with the reason.
// the site publishes the file as it stands, apart from these lines. an entry here that matches nothing fails the tests.

export const OMITTED_CHANGELOG_LINES: { contains: string; reason: string }[] = [
  {
    contains: "melophos.com in every copyright line",
    reason: "The line names a personal domain and the site does not publish personal links. The line stays in CHANGELOG.md for the owner to reword",
  },
];

// the day the feed began. it is the feed's updated time while the changelog has no dated release, so the time never
// depends on when a file was last saved or cloned
export const FEED_STARTED = "2026-11-22";
