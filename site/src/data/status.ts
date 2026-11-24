// what is built, part by part. this file holds the one list of status words the whole site uses: the home page, the
// roadmap, the accessibility page, how it works and the documents all draw their words from STATUS_WORD and a test
// fails when a page or a document uses a word that is not on the list.
// each row carries checks that read the repository's own code (src/lib/checks.ts). tests/claims.test.ts runs them, so a
// row cannot say Built while the code it names is gone. A row cannot say that something is not built while it is.
// every row is a statement about the repository's files and not about hardware: nothing here has run on a real board.

import type { Check } from "../lib/checks.ts";
import { SCORING_CLAIMS } from "./scoring-state.ts";
import { fact, figure, numberWord, profileCount } from "../lib/facts.ts";
import { ROOT } from "../lib/repo.ts";
import { filesUnder } from "../lib/checks.ts";

export type Status = "built" | "host" | "partly" | "progress" | "design" | "planned" | "unchecked";

export const STATUS_ORDER: Status[] = ["built", "host", "partly", "progress", "design", "planned", "unchecked"];

export const STATUS_WORD: Record<Status, string> = {
  built: "Built",
  host: "Host-tested, awaits a board",
  partly: "Partly built",
  progress: "In progress",
  design: "In design",
  planned: "Planned",
  unchecked: "Not yet checked",
};

export const STATUS_MEANING: Record<Status, string> = {
  built: "The code exists and its tests pass on a computer.",
  host: "The hub firmware is built and tested on a computer. It has never run on a board.",
  partly: "Some of it exists and the rest is listed beside it.",
  progress: "Being worked on now. Nothing is claimed about how well it works.",
  design: "Drawn and written down. Nothing is made yet.",
  planned: "On the roadmap. Nothing exists yet.",
  unchecked: "It is built or written and no person or device has checked it yet. Nothing is claimed about how well it works.",
};

export const VERIFIED = "22 November 2026";

export interface Part {
  id: string;
  name: string;
  status: Status;
  built: string;
  // what is not built yet. null when nothing is missing. every entry is a thing to build
  todo: string | null;
  // what is built and has not been checked by a person or a device. null when nothing waits
  unchecked: string | null;
  // properties of the repository that show the row is true today
  checks: Check[];
}

const t = (file: string, title: string): Check => ({ test: { file, title } });
const exists = (...paths: string[]): Check[] => paths.map((exists) => ({ exists }));

// the schematic is stated only when its files are in the repository, so the page never describes a file nobody can open
const hubSchematic = filesUnder(ROOT, "hardware/hub").some((p) => p.endsWith(".kicad_sch"));

export const PARTS: Part[] = [
  {
    id: "studio",
    name: "Studio",
    status: "partly",
    built: `Practice with the next note large or as falling notes, three modes, loops, speeds from ${fact("speedMinPercent")} to ${figure("speedMaxPercent")} and one hand at a time. It imports a MIDI file in your browser and lets you correct which notes belong to which hand. A progress view, a library of built-in pieces, settings, a connection to a MIDI keyboard and on-screen keys for when there is none. A rhythm game with personal bests, whose results are only the scoring engine's own figures. It installs and works offline. Practice stays in your browser unless you link a server you run.`,
    todo: "Screens for the hub.",
    unchecked: "A real server, a screen reader and a tablet at a piano.",
    checks: [
      ...exists("studio/src/app/views/Practise.tsx", "studio/src/app/views/Progress.tsx", "studio/src/app/store.ts", "studio/src/instrument/lane.ts", "studio/src/midi-connection.ts", "studio/src/app/views/Import.tsx", "studio/src/hands.ts", "studio/public/manifest.webmanifest", "studio/sw.template.js"),
      { file: "studio/src/app/update.ts", contains: "serviceWorker" },
      { file: "studio/src/clock.ts", matches: "MIN_SPEED = 0\\.25" },
      t("studio/src/practice.test.ts", "waits on a wrong note and scores it"),
      t("studio/tests/e2e/app-hardening.e2e.ts", "the service worker never touches a request to another origin and never caches a signed-in answer"),
    ],
  },
  {
    id: "scoring",
    name: "Scoring engine",
    status: "progress",
    built: `A Rust engine that follows a performance. ${SCORING_CLAIMS["lines"]!.text} ${SCORING_CLAIMS["verdicts"]!.text} ${SCORING_CLAIMS["timing"]!.text} ${SCORING_CLAIMS["studioTells"]!.text} It has a WebAssembly build for the Studio and a Python module for the server.`,
    todo: "It is still being worked on. A chord struck twice on purpose can shift the reading, practising one hand while also playing the other is read inconsistently where the hands share keys. Hesitations can still cost late marks.",
    unchecked: "A real player and a real keyboard. Every figure comes from synthetic performances and nobody has played into the engine.",
    checks: [
      ...exists("core/src/score.rs", "core/src/follow.rs", "core/wasm", "core/python", "core/fixtures"),
      { file: "core/src/follow.rs", matches: "played_accuracy" },
      { file: "studio/src/scoring.ts", contains: "@melophos/core" },
      { file: "server/app/scoring.py", contains: "melophos_core" },
      ...Object.values(SCORING_CLAIMS).flatMap((c) => c.checks),
      t("core/python/tests/test_fixtures.py", "test_every_case_follows_bit_for_bit"),
    ],
  },
  {
    id: "server",
    name: "Server",
    status: "built",
    built: "Accounts, hub pairing, practice sessions and every note stored in a database, hub traffic over MQTT, signed webhooks, a worker and a song library that reads MIDI files. It runs from Docker Compose files with images pinned by digest. Until a release exists a script builds them on your machine.",
    todo: "Audio and video import, a finished Spotify list and room lights.",
    unchecked: "A real hub.",
    checks: [
      ...exists("server/app/accounts.py", "server/app/ingest.py", "server/app/store.py", "server/app/songs.py", "server/app/webhooks.py", "server/deploy/docker-compose.yml", "server/worker/jobs.py"),
      { file: "server/deploy/docker-compose.yml", absent: "redis|minio" },
      { under: "server/app", absent: "[Ww]eb[Ss]ocket" },
      t("server/tests/test_ingest.py", "test_notes_then_session_store_a_finished_session"),
      t("server/tests/test_accounts.py", "test_pairing_and_device_checks_reveal_nothing_about_which_ids_exist"),
    ],
  },
  {
    id: "firmware",
    name: "Hub firmware",
    status: "host",
    built: `Reads a keyboard through the MIDI jack, USB or Bluetooth and runs the Melody, Rhythm and Listen modes with guide, upcoming and wrong lights in the adopted colours, under a current cap of ${figure("ledCeilingMa")}. It publishes sessions over MQTT and checks signed updates. All of it is tested on a computer.`,
    todo: "Audio input.",
    unchecked: "It has never run on a board. How the lights look through a diffuser.",
    checks: [
      ...exists("firmware/lib/practice/practice.cpp", "firmware/lib/usbhost", "firmware/lib/blemidi", "firmware/lib/midi", "firmware/lib/publish", "firmware/lib/ota", "firmware/src/leds.cpp", "firmware/test/test_practice"),
      { file: "firmware/lib/practice/render.cpp", contains: "kRed[3] = {255, 0, 160}" },
      { file: "firmware/lib/practice/render.cpp", contains: "kAmber[3] = {255, 150, 0}" },
      { file: "firmware/platformio.ini", contains: "[env:native]" },
      t("firmware/test/test_practice/test_main.cpp", "test_the_ceiling_is_the_boards_figure_and_the_last_step_before_the_strip"),
    ],
  },
  {
    id: "profiles",
    name: "Instrument profiles",
    status: "built",
    built: `A schema and ${numberWord(profileCount())} profiles: keyboards of 61, 76 and 88 keys, an 88 key keyboard with a plain LED strip and a six-string guitar.`,
    todo: null,
    unchecked: "A real instrument.",
    checks: [...exists("profiles/schema.json", "profiles/piano-61.json", "profiles/piano-76.json", "profiles/piano-88.json", "profiles/piano-88-strip-144.json", "profiles/guitar-6-standard.json", "profiles/check_profiles.py"), { file: "profiles/check_profiles.py", contains: "schema" }],
  },
  {
    id: "hub-board",
    name: "Hub board",
    status: "design",
    built: `The requirements and a draft bill of materials. The power budget is still being finalised with the board.${hubSchematic ? " The schematic." : ""}`,
    todo: `${hubSchematic ? "" : "The schematic files are not in this repository yet. "}The board layout is not drawn and no board has been made.`,
    unchecked: null,
    checks: [...exists("hardware/hub/README.md", "hardware/bom/hub-rev-a.csv"), { under: "hardware/hub", noFileNamed: "\\.kicad_pcb$" }],
  },
  {
    id: "led-bars",
    name: "Octave LED bars",
    status: "design",
    built: "The requirements for a bar of 12 lights at real key spacing. The bars are designed to join end to end, with short end bars for the keys left over.",
    todo: "The design files. No bar has been made.",
    unchecked: null,
    checks: [...exists("hardware/keys-octave/README.md"), { under: "hardware/keys-octave", noFileNamed: "\\.kicad_pcb$" }],
  },
];
