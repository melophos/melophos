# Roadmap

MELOPHOS is built in three versions. Each one is useful on its own, so the project never waits on its most ambitious features.

> [!NOTE]
> Dates are targets, not promises. Progress is tracked in the issues and milestones on [melophos/melophos](https://github.com/melophos/melophos).

## v0: scaffold (done)

- [x] Monorepo with firmware, hardware, core, server, Studio, client, profiles and docs
- [x] Instrument profile schema and profiles for 61, 76 and 88 keys and a six-string guitar
- [x] Note-to-LED mapping and note bus in firmware, tested on the host
- [x] Server API for practice sessions with summaries and a per-key heatmap
- [x] Hub simulator for development without hardware
- [x] Studio keyboard that shows notes from any WebMIDI device
- [x] CI for every component and publishing of each component to its own repository

## v1: works on a real piano (target: December 2026)

### Hardware

- [ ] Bring-up on an ESP32-S3 development board with a 144 LED/m strip
- [ ] Hub board rev A in KiCad: ESP32-S3 module, USB-C power, current-limited USB host port, level-shifted LED outputs, MIDI in and out on 3.5 mm TRS, audio input
- [ ] Octave LED bar rev A: 12 LEDs placed at real key spacing, daisy-chained
- [ ] First boards manufactured and assembled
- [ ] 3D-printed enclosure and a mounting rail for the bars

### Firmware

- [ ] USB-MIDI host through TinyUSB, powering the instrument from the hub
- [ ] Bluetooth MIDI through NimBLE, visible to Synthesia and the Studio
- [ ] Profiles stored in flash and switched from the Studio
- [ ] Melody, Rhythm and Listen modes with wrong-note and upcoming-note lights
- [ ] Sessions published over MQTT
- [ ] Updates over Wi-Fi and a browser-based installer

### Scoring engine (Rust)

- [x] First scoring pass: matches each expected note with the closest press of the same pitch inside a timing window, then counts hits, misses and wrong notes
- [ ] Tempo tracking with dynamic time warping, so a steady but slower performance is not scored as late
- [ ] WebAssembly build used by the Studio for live scoring
- [ ] Python module (PyO3) used by the server for stored sessions

### Server and Studio

- [ ] Postgres storage behind the existing session API
- [ ] MQTT ingestion from hubs
- [ ] Accounts and device pairing
- [ ] Song library with MIDI import
- [ ] Practice view: falling notes, looping, slow-down and one-hand practice
- [ ] Progress view: streaks, heatmap, accuracy and tempo per piece
- [ ] Webhook integration for external dashboards

## v2: platform (target: first half of 2027)

- [ ] Remote lessons: a teacher's playing lights the student's instrument live over WebRTC
- [ ] Audio import with polyphonic transcription
- [ ] Tutorial video import for falling-note videos the user has the rights to use
- [ ] Spotify learn list from listening history
- [ ] Room lights through WLED and Home Assistant
- [ ] Rhythm game mode with personal bests
- [ ] Published container images and a one-command install guide

## v3: any instrument (target: second half of 2027)

- [ ] Fret bar and guitar profiles in use on a real guitar
- [ ] Guitar note detection through the audio input, then a hexaphonic pickup for full chords
- [ ] Fingering coach using webcam hand tracking in the Studio
- [ ] Optical key sensor bar that turns an acoustic piano into a MIDI instrument
- [ ] On-device note onset detection with a small neural network on the ESP32-S3
- [ ] A Rust port of the hub firmware, compared against the C++ version in a write-up
- [ ] Open hardware certification and a kit for other builders
