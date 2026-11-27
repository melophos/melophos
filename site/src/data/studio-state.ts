// what is true of the Studio app, as the site states it. every statement carries checks that read the Studio's own
// code (src/lib/checks.ts) and tests/studio-claims.test.ts runs them, so a statement whose evidence disappears or
// appears fails the tests until the site is read again and this file is updated. a statement that something is
// built needs a check in code. a statement that a person has not yet checked something can only rest on the Studio's
// own README, since no code can show that nobody has looked. a statement about behaviour also names a test that lives
// in the Studio and the site checks that the test exists, is not skipped and asserts something. where the Studio has no
// such test the statement is marked Not yet checked as a test the Studio needs.
// the files are read and never edited from here.

import type { Check } from "../lib/checks.ts";
import { assertSharedLimits, fact, figure } from "../lib/facts.ts";

assertSharedLimits();
import type { Status } from "./status.ts";

export const STUDIO_READ_ON = "22 November 2026";

export interface StudioClaim {
  id: string;
  // the short name the accessibility page shows beside the statement
  title: string;
  text: string;
  // built, planned (a screen that does not exist) or unchecked (it exists and no person or device has checked it)
  kind: Extract<Status, "built" | "planned" | "unchecked">;
  checks: Check[];
}


const t = (file: string, title: string): Check => ({ test: { file, title } });
// every way a Studio file can start a request to an address: a call, a stream, a socket, a beacon, an image or a script
const REQUEST = "\\bfetch\\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|new Image\\(|importScripts|\\.src\\s*=|createElement\\([\"'`]script";

export const STUDIO_CLAIMS: StudioClaim[] = [
  {
    id: "practice",
    title: "Practice view",
    kind: "built",
    text: `A practice view with three modes. Melody waits and shows the next note large. Rhythm and Listen show falling notes. Speed runs from ${fact("speedMinPercent")} to ${figure("speedMaxPercent")}, either hand or both, a range of bars can loop and the metronome accents the first beat.`,
    checks: [
      t("studio/src/clock.test.ts", "rejects an empty loop and clamps the speed to 25 to 125 per cent"),
      t("studio/src/practice.test.ts", "waits on a wrong note and scores it"),
      { file: "studio/src/clock.ts", matches: "MIN_SPEED = 0\\.25" },
      { file: "studio/src/instrument/session.ts", contains: '"melody"' },
      { file: "studio/src/instrument/session.ts", contains: '"rhythm"' },
      { file: "studio/src/instrument/session.ts", contains: '"listen"' },
      { file: "studio/src/audio.ts", contains: "accent" },
    ],
  },
  {
    id: "shapes",
    title: "A shape for every light",
    kind: "built",
    text: "Every light and key state has a shape or a word as well as a colour: a disc for the right hand, a square for the left, a ring for coming up and a cross with the words wrong note for a wrong key.",
    checks: [t("studio/tests/e2e/app.e2e.ts", "every lit state has a shape as well as a colour"), { file: "studio/src/styles/lights.json", contains: "Large filled square" }],
  },
  {
    id: "settings",
    title: "Settings",
    kind: "built",
    text: "Settings for the theme, more contrast, a distance setting that makes type and targets larger, motion, light sensitivity, a beat indicator that can be switched off, note names, sound and the keys that work in practice.",
    checks: [
      t("studio/src/app/settings.test.ts", "keeps valid values and drops the rest"),
      { file: "studio/src/app/settings.ts", contains: 'distance: "near" | "stand" | "far"' },
      { file: "studio/src/app/settings.ts", contains: "lightSensitivity" },
      { file: "studio/src/app/settings.ts", contains: "beatIndicator" },
    ],
  },
  {
    id: "screen-reader",
    title: "For a screen reader",
    kind: "built",
    text: "One announcement at the start of each phrase, a What is next button and the result at the end. There is no live region for every note.",
    checks: [t("studio/tests/e2e/app.e2e.ts", "what is next reads out the next notes on request"), { file: "studio/src/app/views/Practise.tsx", contains: 'data-testid="announcer"' }],
  },
  {
    id: "browser-checks",
    title: "Browser checks",
    kind: "built",
    text: "Its views are checked in a browser on every change with axe in both themes and in forced colours, at 320, 390, 768 and 1440 pixels wide, with the text doubled and with reduced motion.",
    checks: [t("studio/tests/e2e/app.e2e.ts", "axe finds no violation in forced colours or with more contrast"), { file: "studio/tests/e2e/app.e2e.ts", contains: "[320, 390, 768, 1440]" }],
  },
  {
    id: "import",
    title: "Import a MIDI file",
    kind: "built",
    text: `It imports a MIDI file in your browser. The file is read with the server's own limits: ${figure("midiMaxMiB")}, ${figure("midiMaxTracks")}, ${figure("midiMaxNotes")} and ${figure("midiMaxHours")}. A file it cannot read gets a plain reason.`,
    checks: [
      t("studio/src/midi-file.test.ts", "is too big, has too many tracks or no notes"),
      t("studio/src/imports.test.ts", "says why a file cannot be read and never reads a file that is too big"),
    ],
  },
  {
    id: "rhythm-game",
    title: "Rhythm game and personal bests",
    kind: "built",
    text: "A rhythm game plays one piece once through in Rhythm mode with the notes falling to the keys. You choose the tempo, the hand and a range of bars. None of them changes how strictly a note is judged. A result is only the scoring engine's own figures: accuracy, notes hit, hit late, missed, wrong and keys not judged. A key not judged counts neither for nor against you and never changes a best. There are no points, stars, levels or streaks and no comparison with other people. The game makes no sound unless you turn sound on. A personal best is the highest engine accuracy for the same piece, hand, tempo and range of bars. It is only what the scoring engine thinks. Nothing from the game is sent to a server.",
    checks: [
      t("studio/src/game.test.ts", "takes every number from a field of the engine's summary"),
      t("studio/src/game.test.ts", "is a new best only for a higher engine accuracy and an equal one is not"),
      t("studio/src/game.test.ts", "keeps a best for each song, tempo, hand and range of bars apart"),
      t("studio/tests/e2e/app-game.e2e.ts", "the game makes no sound until the player turns it on"),
      t("studio/tests/e2e/app-game.e2e.ts", "the difficulty is tempo, hands and bars and nothing about how strictly notes are judged"),
      t("studio/tests/e2e/app-game.e2e.ts", "a game result is not sent anywhere: the saved server is not called when a game ends"),
    ],
  },
  {
    id: "hands",
    title: "Hands of an imported piece",
    kind: "built",
    text: "The split of an imported piece into left and right hand is a first guess. You can correct it note by note or with a split point, undo one step at a time and go back to the guess.",
    checks: [t("studio/src/hands.test.ts", "undoes one step at a time and goes back to the guess"), t("studio/src/hands.test.ts", "splits at a pitch inside a range of notes")],
  },
  {
    id: "offline",
    title: "Install and offline use",
    kind: "built",
    text: "It installs from a manifest and works offline after the first load. A service worker keeps one versioned cache of its own files and never touches a request to another origin. A new version waits until you press Update.",
    checks: [
      t("studio/tests/e2e/app-hardening.e2e.ts", "the service worker never touches a request to another origin and never caches a signed-in answer"),
      t("studio/src/app/update.test.ts", "waits while a piece is running and reloads the moment it stops"),
      t("studio/tests/pwa.test.ts", "is a standalone app that starts on the app page in landscape with every icon present"),
    ],
  },
  {
    id: "stores-in-browser",
    title: "Kept in your browser",
    kind: "built",
    text: "Sessions, imported pieces, personal bests and settings are kept in this browser only, in IndexedDB and local storage. A simulated run is never saved. Export, import and delete everything include the bests.",
    checks: [
      t("studio/src/app/store.test.ts", "round trips every record"),
      t("studio/tests/e2e/app.e2e.ts", "a simulated run is labelled and never saved"),
      t("studio/tests/e2e/app-game.e2e.ts", "bests travel with an export and an import and go with Delete everything"),
      { file: "studio/src/app/store.ts", contains: "bests" },
      { file: "studio/src/app/store.ts", contains: "indexedDB" },
      { file: "studio/src/app/store.ts", contains: "export async function wipeEverything" },
    ],
  },
  {
    id: "network",
    title: "What it sends",
    kind: "built",
    text: "The Studio is built to send a request only to the server address you type in its settings, apart from loading its own files and updates from its host. It is built to send nothing to any other address and nothing at all until you link a server.",
    checks: [
      t("studio/tests/e2e/app-network.e2e.ts", "the Studio requests nothing but the saved server address"),
      // every file and every way of making a request. the two files that may send are the only ones that do
      { under: "studio/src", pattern: REQUEST, only: ["studio/src/app/server.ts", "studio/src/app/api-source.ts"], },
      { file: "studio/public/manifest.webmanifest", absent: "https?://" },
      { file: "studio/index.html", absent: "src=[\"']https?:" },
      { file: "studio/index.html", absent: "<link.*https?://" },
      { file: "studio/index.html", absent: "<script.*https?://" },
      // and where those two send: to the checked base address and never to a written-out address
      { file: "studio/src/app/server.ts", contains: "new URL(path, checked.base)" },
      { file: "studio/src/app/server.ts", absent: "fetch\\(\\s*[\"'`]https?:" },
      { file: "studio/src/app/api-source.ts", absent: "fetch\\(\\s*[\"'`]https?:" },
    ],
  },
  {
    id: "own-server",
    title: "Your own server",
    kind: "built",
    text: "With the address of a server you run it can pair a hub with the code the hub shows, send an imported piece with its corrected hands, read sessions with their score state and delete your data on the server. The sign-in token is held in memory only and is gone when the page closes.",
    checks: [
      t("studio/src/app/serverLink.test.ts", "is never written to storage"),
      t("studio/src/app/server.test.ts", "sends the code as the documented body with the account token"),
      t("studio/src/app/server.test.ts", "deletes the account only with the password in the body and says so when it is wrong"),
      // no Studio file puts a token in any storage, not only the two that hold it
      ...["localStorage", "sessionStorage", "indexedDB"].flatMap((store): Check[] => [{ under: "studio/src", absent: `${store}.*[Tt]oken` }, { under: "studio/src", absent: `[Tt]oken.*${store}` }]),
      { file: "studio/src/app/serverLink.ts", absent: "localStorage|sessionStorage|indexedDB" },
      { file: "studio/src/app/server.ts", absent: "localStorage|sessionStorage|indexedDB" },
    ],
  },
  {
    id: "spoken-voice",
    title: "Spoken note names",
    kind: "built",
    text: "Spoken note names are optional and off until you switch them on. The Studio speaks only with a voice that runs on your device. If your browser has none, nothing is spoken unless you allow an online voice after being told that the words then go to your browser's speech service.",
    checks: [
      t("studio/src/speech.test.ts", "prefers a local British voice and never picks an online one unasked"),
      t("studio/src/speech.test.ts", "uses an online voice only when it is allowed"),
      { under: "studio/src", pattern: "speechSynthesis\\.speak\\(", only: ["studio/src/speech.ts"] },
    ],
  },
  {
    id: "hub-screens",
    title: "Screens for the hub",
    kind: "planned",
    text: "Hub control, the fit wizard and the firmware installer are not built. The Studio has no screen for them.",
    checks: [
      {
        under: "studio/src/app/views",
        pattern: ".",
        only: [
          "studio/src/app/views/About.tsx",
          "studio/src/app/views/Bests.tsx",
          "studio/src/app/views/Devices.tsx",
          "studio/src/app/views/GameResult.tsx",
          "studio/src/app/views/Diagnostics.tsx",
          "studio/src/app/views/HandEditor.tsx",
          "studio/src/app/views/Import.tsx",
          "studio/src/app/views/Library.tsx",
          "studio/src/app/views/Piece.tsx",
          "studio/src/app/views/Practise.tsx",
          "studio/src/app/views/Progress.tsx",
          "studio/src/app/views/ServerPiece.tsx",
          "studio/src/app/views/Settings.tsx",
          "studio/src/app/views/Start.tsx",
          "studio/src/app/views/Summary.tsx",
          "studio/src/app/views/serverStore.ts",
        ],
      },
      { file: "studio/README.md", contains: "Hub control, the fit wizard and the firmware installer" },
    ],
  },
  {
    id: "no-real-server",
    title: "A real server",
    kind: "unchecked",
    text: "The link to a server, pairing and every call to a hub have run only against a fake server in the Studio's tests. They have not run against a real server or a real hub.",
    checks: [{ exists: "studio/src/app/server.test.ts" }, { file: "studio/README.md", contains: "run only against a fake server in the tests" }],
  },
  {
    id: "no-screen-reader-test",
    title: "A screen reader",
    kind: "unchecked",
    text: "No person who uses a screen reader has tested the Studio. Spoken note names need a check with a screen reader and a speech voice.",
    checks: [{ file: "studio/README.md", contains: "need a screen reader and speech voice check by a person" }],
  },
  {
    id: "browsers",
    title: "Other browsers and a tablet",
    kind: "unchecked",
    text: "Only Chromium has been tried. Firefox and Safari have not been tried. No tablet has been used at a piano.",
    checks: [
      { file: "studio/README.md", contains: "Only Chromium" },
      { file: "studio/README.md", contains: "Nothing here has run on real hardware or on a tablet" },
    ],
  },
];

// a statement by id. a page that states it takes the text from here, so the page and the checks cannot disagree
export function studioClaim(id: string): StudioClaim {
  const claim = STUDIO_CLAIMS.find((c) => c.id === id);
  if (!claim) throw new Error(`no Studio statement called ${id}`);
  return claim;
}
