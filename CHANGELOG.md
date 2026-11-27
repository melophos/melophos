# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Tidies the public docs and the site's guards.

### Changed

- Routine tidy-up of the docs: the bench inventory, the owner setup and publishing steps and internal references leave the repository. The test keyboard's USB facts move to `firmware/docs/usb-midi.md`.
- The site's guards check private names by hash, so the lists no longer spell them out.

### Fixed

- The community privacy page said a report keeps up to 500 characters of the reported message. A report holds a link to the message and the reporter's own words.

## [0.1.0] - 2026-11-25

### Added

- The server stores and returns the scoring engine's `unsure` count (a press it cannot place with confidence, which counts neither for nor against the player) and scores every session again with the redesigned engine. The scoring call can take the hand practised, the start position and jumps, which no message carries yet. See [server/README.md](server/README.md).
- Container images and a one-command install for the server. A release workflow builds the server and broker images natively for amd64 and arm64 and signs them without a stored key. It attaches build provenance and a bill of materials and attests the release files. It creates a draft release only after a gate has checked the tag, the commit and CI. The compose file names every image by digest. The images install Python packages from hashed lock files. `deploy/install.sh` checks every download and every signature before it changes anything. The backup and restore scripts check the dump first, restore into a new database and can encrypt with age. A Raspberry Pi 5 section has measured memory. The workflow has not run yet. Nothing has run on a Raspberry Pi 5. The release path is covered by the server tests, with lint, types, shellcheck and actionlint clean. See [docs/self-hosting.md](docs/self-hosting.md).
- The public website in `site/`: a Next.js static site that reads `docs/`, `CHANGELOG.md`, the bill of materials and the Studio design tokens at build time, with a keyboard figure, a status word on every part, accessibility, privacy and licence pages and a build that fails on a broken link, a missing alt text or a failed check. It is not published to its own repository. See [site/README.md](site/README.md).
- The server stores sessions and note events in Postgres and TimescaleDB with recorded migrations, stable paginated lists and tests against a real database. Accounts with argon2id passwords, revocable sign-ins and rate limits, hub pairing with a short code and per-account isolation. Hub traffic over MQTT with a broker that lets a hub publish only under its own id, payload and rate checks and replay protection. Signed session webhooks that refuse internal addresses and back off on failure. A song library with a bounded MIDI reader, a hand split and a difficulty rating. The simulator can pair and publish over MQTT. See [server/README.md](server/README.md).
- The scoring engine as a Python module (`core/python/`, PyO3 and maturin). One `abi3` wheel runs on Python 3.9 and later. It has typed results and a `ScoringError`. The shared fixtures through Python match the native build bit for bit. The interface is written in `core/README.md`. CI builds the wheel on Python 3.12 and 3.14 in the new `Core (Python module)` job.
- The scoring engine builds to WebAssembly with a small typed wrapper and a reproducible build script (`core/wasm/`, an 84 KB module with the `unsure` outcome). Node tests run the same fixtures as the native build and compare every result bit for bit. CI builds it in the new `Core (WebAssembly)` job and `make test-core-wasm` runs it locally. The Studio loads it for scoring.
- Tempo tracking in the scoring engine. `follow` reads a live performance against the piece with each hand on its own line and one shared tempo, so a steady slow performance is not scored as late and one early hesitation does not fix the tempo. A press it cannot place with confidence comes back as `unsure` and counts neither for nor against the player. The caller can name the hand practised and give the start and jumps. It copes with wrong notes, skipped notes, repeated passages, rolled chords, a pause and a restart. A labelled corpus (1,814 cases) and property tests guard it and it passes its own checks in Rust, WebAssembly and Python. [docs/scoring.md](docs/scoring.md) states its algorithm and bounds. The earlier followers called 109 of 62,959 right presses wrong on one synthetic set. On a second unseen synthetic set the redesign called 33 of 86,197 right notes wrong. It is still work in progress: a chord struck twice on purpose can shift the reading, practising one hand while playing the other is read inconsistently where the hands share keys and hesitations still cost late marks.
- Design foundations for the Studio: colour tokens in four sets (light and dark with a more contrast version of each, chosen with `data-theme` and `data-contrast`) with a measured contrast pair list, self-hosted Atkinson Hyperlegible fonts with fallback metrics and a small music font subset for sharp, flat and natural signs, base styles with a visible focus ring, the Phosphor icon set and a specimen page (`npm run specimen`). The Studio screens use the tokens and the specimen page shows them.
- Checks for contrast, colour vision, product rules, fonts, licences and accessibility, with Lighthouse budgets and a browser job, run in CI as the new `studio-licences` and `studio-browser` jobs and through `npm run check`. `make test-studio` now runs `npm test` first.
- The wrong-note light is rose-magenta in the design tokens, with a cross and words, so it does not rely on red against green. The hub firmware uses the same colour (checked by host tests only, never on a real light).
- `NOTICE.md` lists the bundled fonts and the Phosphor icons with their licences.
- A rhythm game in the Studio with personal bests (issue 34). A best is kept in the browser with the song, the difficulty and the engine build. Export, import and Delete everything cover it and nothing is sent to a server.
- Hub firmware: profiles kept in flash and set from the Studio, Melody, Rhythm and Listen modes with lights that do not rely on colour, USB-MIDI keyboards, Bluetooth MIDI (`ble pair` for two minutes and at most 4 accepted devices), practice sessions published over MQTT at QoS 1 with a flash copy of the last session and Wi-Fi updates. No light makes more than 3 large rises a second, the whole strip makes no more than 2, no more than 30 lights go out a second and the current ceiling is 2,700 mA (1,200 mA while audio runs). The hub asks the server for the time every 15 minutes and accepts a 180 second difference. The tests are host tests. The clock rework and the Bluetooth allow-list are covered by them only. Nothing has run on a real hub or a real light strip.
- The server reports `server_time` (whole UTC seconds) and `server_time_synced`. It refuses to start before its own build time. `server_time_synced` is true, false or null and a hub holds sessions when it is false. The server stores and returns the engine's `unsure` count. The server's engine wheel was built before the latest follower change and needs rebuilding and proving.
- The website's claims about the Studio each carry a status word (13 built, 1 planned and 3 unchecked of 17) and a check that reads the Studio code. We closed an unqualified privacy claim and four gaps in the checks and tested the checks with breakages of our own. Nothing is deployed.
- Status badges for CI, markdown linting, the secret scan and the licence at the top of the README.
- The Studio practice and progress views, built on the design foundations. The practice view has an SVG keyboard and light rail with a shape for every state (disc and square for the hands, ring and hollow square for coming up, cross for wrong), Melody, Rhythm and Listen modes, falling notes on a canvas with a still page under reduced motion, loop, speed from 25 to 125 per cent, one hand at a time, a count-in and a metronome, hands-free keys and pedal, a screen reader text line with one announcement a phrase and scoring from the WebAssembly engine, where a key the engine is not sure about shows as Not judged and counts neither way. A wrong note is shown at once and taken back if the engine reads it differently. Bests set with an older engine appear under Earlier results. The progress view has the days practised (no streak counter), per piece charts with a table behind each and a per key view of the keys that went wrong. Also a Web MIDI flow with every state, input calibration, settings for display and note names, export and import of the record and a diagnostics page. The Studio also imports a MIDI file in the browser and treats the split into hands as a first guess that can be corrected and undone, works offline from a hand-written service worker with an update that is offered and never forced, installs from a manifest and has an optional link to the player's own server (pairing, sending a piece and its hands, reading sessions with honest score states). See [studio/README.md](studio/README.md).
- Melody practice in the Studio. A light strip above the on-screen keyboard shows the next note in amber with the two after it dimmed, as the hub's LEDs will. Each note is checked for pitch and timing, a wrong note is marked while the light waits on the right one and a summary shows accuracy, average timing and best streak.
- Three public-domain songs and a **Play demo** button that plays a song with a simulated player, driving the same scoring as a MIDI keyboard.
- The MELOPHOS wordmark and mark in the Studio, with the brand palette and a keyboard that fits the screen without scrolling.
- `assets/brand/linkedin/`: the logo, cover image and profile text for the [MELOPHOS LinkedIn page](https://www.linkedin.com/company/melophos/), linked from the brand README.
- An email-safe mark with outlined keys that reads on light and dark backgrounds, as an SVG source plus 256, 512 and 1000px PNGs.
- `ACCESSIBILITY.md` at the root, summarising [docs/accessibility.md](docs/accessibility.md) so the statement shows on the repository page.
- A **Research** discussion form for papers, datasets and open questions that are not an issue yet
- melophos.com in every copyright line alongside isaacadjei.me.
- Monorepo scaffold: firmware, hardware, core, server, studio, client, profiles and docs components, each self-contained with its own README and licence.
- Discussion forms for Q&A and General alongside Ideas and Show and tell.
- `assets/` folder for brand files, photos, diagrams, renders and screenshots, with a social preview card.
- Rust scoring engine that matches played notes with expected notes and scores hits, misses, wrong notes and timing.
- Instrument profile schema with profiles for 61, 76 and 88 key keyboards and a six-string guitar in standard tuning.
- Initial database schema for devices, instruments, practice sessions, note events, songs and recordings.
- Hub simulator for developing the server and Studio without hardware.
- Continuous integration for every component, markdown linting, secret scanning and publishing of each component folder to its own repository.

### Changed

- `CONTRIBUTING.md` has a Security section pointing at SECURITY.md and security@melophos.com.
- Community files follow the [AI policy](https://github.com/melophos/.github/blob/main/AI_POLICY.md): pull requests declare AI use and issue forms ask whether AI helped. Security reports go to security@melophos.com.
- Conduct reports, security reports and general enquiries go to contact@melophos.com.
- CI keeps the firmware's compiled objects between runs, so a firmware build only recompiles what changed.
- The published component repositories credit the project's automation account for each commit. Messages and dates are unchanged.
- Tidied the contributor guide.
- The README and `docs/architecture.md` use Mermaid diagrams. The architecture doc adds a practice session walkthrough and a table of what each component has built so far. The README explains the name.
- CI tests the server and client on Python 3.12 and 3.14. 3.12 is the minimum they support and 3.14 is what the server image runs.

### Fixed

- The browser support notes in the root and Studio READMEs agree: WebMIDI works in Chrome, Edge and desktop Firefox 108 and later (behind a site permission add-on prompt), not in Safari or Firefox for Android. The architecture status table lists the note bus ring buffer as built.
- Each publish run checks out the latest `main`, so a push event that arrives late can no longer publish stale history to the component repositories.
- The pull request template's links and two support answers now match the project and current browser support.
