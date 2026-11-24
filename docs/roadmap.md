# Roadmap

MELOPHOS is built in three versions. Each one is useful on its own, so no version waits for the next.

> [!NOTE]
> Dates are targets, not promises. Progress is tracked in the issues and milestones on [melophos/melophos](https://github.com/melophos/melophos).

How to read the boxes. A ticked item is built and its tests pass on a computer. An item that ends with "(host-tested, awaits a board)" is a hub feature that is built and tested on a development machine and has never run on a board. An item that ends with "(in progress)" is being worked on and is partly built. An unticked item that ends with "(not yet checked)" is waiting for a check by a person or a device. An unticked item with no note is planned. Nothing has run on real hardware and no board has been made.

## v0: scaffold (done)

- [x] Monorepo with firmware, hardware, core, server, Studio, client, profiles and docs
- [x] Instrument profile schema and profiles for 61, 76 and 88 keys and a six-string guitar
- [x] Note-to-LED mapping and note bus in firmware, tested on the host
- [x] Server API for practice sessions with summaries. A per-key heatmap function exists and has no route yet
- [x] Hub simulator for development without hardware
- [x] Studio keyboard that shows notes from any Web MIDI device
- [x] CI for every component and publishing of each component to its own repository

## v1: works on a real piano (target: February 2027)

### Hardware

- [ ] Bring-up on an ESP32-S3 development board with a 144 LED/m strip
- [ ] Hub board rev A in KiCad: ESP32-S3 module, USB-C power, current-limited USB host port, level-shifted LED outputs, MIDI in and out on 3.5 mm TRS, audio input (in progress: the requirements and a draft bill of materials are written and there is no board layout)
- [ ] Octave LED bar rev A: 12 LEDs placed at real key spacing, daisy-chained
- [ ] First boards manufactured and assembled
- [ ] 3D-printed enclosure and a mounting rail for the bars

### Firmware

- [x] USB-MIDI host, powering the instrument from the hub (host-tested, awaits a board)
- [x] Bluetooth MIDI through NimBLE, designed to be visible to Synthesia and the Studio (host-tested, awaits a board)
- [ ] Profiles stored in flash and switched from the Studio (in progress: the firmware side is host-tested and the Studio side is not built)
- [x] Melody, Rhythm and Listen modes with wrong-note and upcoming-note lights (host-tested, awaits a board)
- [x] Sessions published over MQTT (host-tested, awaits a board)
- [x] Updates over Wi-Fi and a browser-based installer (host-tested, awaits a board)

### Scoring engine (Rust)

- [x] First scoring pass: matches each expected note with the closest press of the same pitch inside a timing window, then counts hits, misses and wrong notes
- [ ] A follower that treats each hand as its own line with one shared tempo, judges timing against the player's own tempo and calls a press not judged when it cannot place it (in progress and still being worked on. Every figure comes from synthetic performances, see [scoring.md](scoring.md))
- [x] WebAssembly build used by the Studio for live scoring
- [x] Python module (PyO3) used by the server for stored sessions
- [ ] Scoring measured on recordings of real players (not yet checked)

### Server and Studio

- [x] Postgres storage behind the session API
- [x] MQTT ingestion from hubs
- [x] Accounts and device pairing: the server routes and the Studio's pairing by code
- [ ] Pairing and the Studio's link to a server checked against a real server and a real hub (not yet checked: the Studio has only run against a fake server)
- [x] Song library with MIDI import in the server and in the Studio, with hands the player can correct
- [x] Studio that installs and works offline from a service worker
- [x] Practice view: falling notes, looping, slow-down and one-hand practice
- [x] Progress view: days practised, charts for each piece and the keys that went wrong
- [x] Webhook integration for external dashboards
- [ ] Studio screens for the hub: control, the fit wizard and the firmware installer

## v2: platform (target: first half of 2027)

- [ ] Remote lessons: a teacher's playing lights the student's instrument live over WebRTC
- [ ] Audio import with polyphonic transcription
- [ ] Tutorial video import for falling-note videos the user has the rights to use
- [ ] Spotify learn list from listening history
- [ ] Room lights through WLED and Home Assistant
- [x] Rhythm game mode with personal bests in the Studio. A result is the scoring engine's own figures with no points, stars, levels or streaks
- [ ] Published container images and a one-command install guide

## v3: any instrument (target: second half of 2027)

- [ ] Fret bar and guitar profiles in use on a real guitar
- [ ] Guitar note detection through the audio input, then a hexaphonic pickup for full chords
- [ ] Fingering coach using webcam hand tracking in the Studio
- [ ] Optical key sensor bar that turns an acoustic piano into a MIDI instrument
- [ ] On-device note onset detection with a small neural network on the ESP32-S3
- [ ] A Rust port of the hub firmware, compared against the C++ version in a write-up
- [ ] Open hardware certification and a kit for other builders
