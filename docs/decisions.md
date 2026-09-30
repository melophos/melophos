# Architecture decisions

Short records of the choices that shape MELOPHOS, why they were made and what would change them. Newest last.

## ADR 1: ESP32-S3 for the hub

**Decision.** The hub runs on an ESP32-S3.

**Why.** It is the one widely available chip with a USB OTG host port (to read and power a USB-MIDI keyboard), Bluetooth LE (for Bluetooth MIDI) and Wi-Fi in a single pre-certified module with its antenna.

| Option | USB host | Bluetooth LE | Wi-Fi | Why not |
| --- | --- | --- | --- | --- |
| ESP32-S3 | Yes | Yes | Yes | Chosen |
| Classic ESP32 | No | Yes | Yes | Cannot read a USB-MIDI keyboard. Kept as the `esp32-bringup` build for early LED and Bluetooth work |
| RP2350 (Pico 2 W) | Yes | Through a separate radio chip | Through a separate radio chip | A custom board needs a second radio module and antenna layout. Bluetooth MIDI support is less mature |
| STM32F4 | Yes | No | No | No radio. A good fit for the v3 optical sensor bar, which needs fast scanning rather than wireless |
| ATmega (Arduino Nano, Mega) | No | No | No | Too little RAM to hold a song, no radio |

**Revisit if** a single-module part adds USB host, Bluetooth LE and Wi-Fi with better tooling.

## ADR 2: C++ for firmware

**Decision.** Firmware is C++ on the Arduino core over ESP-IDF, built with PlatformIO.

**Why.** The two hardest inputs, USB-MIDI host (TinyUSB) and Bluetooth MIDI (NimBLE), have mature C and C++ stacks. Rust on the ESP32-S3 needs Espressif's forked Xtensa compiler and lacks both stacks today.

**Revisit if** Rust gains a stable USB host and Bluetooth MIDI stack for the ESP32-S3. A Rust port is planned as a v3 experiment.

## ADR 3: Rust for the scoring engine

**Decision.** Scoring (aligning played notes with expected notes, then scoring accuracy, timing and tempo) is one Rust crate, compiled to WebAssembly for the Studio and to a Python module for the server.

**Why.** The Studio and the server must agree exactly on a score. One implementation in a fast, memory-safe language that targets both avoids two copies drifting apart.

## ADR 4: Monorepo with published component repositories

**Decision.** All work happens in `melophos/melophos`. Each component folder is published to its own read-only repository on every merge.

**Why.** Changes that cross components (a protocol field used by the hub, the server and the Studio) land in one pull request and one review. People who only need one component still get a small, focused repository with its own history.

## ADR 5: AGPL for software, CERN-OHL-S for hardware

**Decision.** Software is AGPL-3.0-or-later. Hardware is CERN-OHL-S-2.0.

**Why.** Both keep improvements open. The AGPL also covers modified servers offered as a network service, which matters for a self-hostable platform. Both licences are accepted for open hardware certification.

## ADR 6: KiCad for hardware design

**Decision.** Boards are designed in KiCad.

**Why.** It is free, open source and runs on macOS, Linux and Windows, so anyone can open and modify the designs as the hardware licence intends. Fabrication houses accept its outputs directly.

## ADR 7: MQTT between hubs and the server

**Decision.** Hubs publish to an MQTT broker rather than calling the HTTP API.

**Why.** MQTT keeps a hub's connection light and resilient on flaky Wi-Fi, fits the publish-and-forget nature of note batches and lets other home systems (Home Assistant, for example) subscribe to the same topics.

## ADR 8: TimescaleDB for note events

**Decision.** Note events live in a TimescaleDB hypertable inside the main Postgres database.

**Why.** A single session can produce thousands of rows. A hypertable keeps time-range queries fast and compresses old data, without running a second database.

## ADR 9: Profiles as data

**Decision.** Instruments are described by JSON profiles validated against one schema.

**Why.** Supporting a new keyboard or a guitar becomes a data change anyone can contribute, not a firmware change.

## ADR 10: Five languages, each with one job

**Decision.** MELOPHOS uses C++, Rust, Python, TypeScript and SQL. No other language is added without a new decision record.

| Language | Where | Why this one |
| --- | --- | --- |
| C++ | `firmware/` | Mature ESP32-S3 stacks for USB host, Bluetooth MIDI and LED output |
| Rust | `core/` | One fast, memory-safe scoring engine that compiles to WebAssembly and to a Python module |
| Python | `server/`, `client/` | FastAPI plus the transcription models, which are Python |
| TypeScript | `studio/` | The browser is where WebMIDI, Web Bluetooth and WebRTC live |
| SQL | `server/db/` | Postgres and TimescaleDB schema |

**Why not others.** Every extra language adds a toolchain, a CI job and a skill every contributor needs. Go would duplicate what Python already does on the server. Java, Ruby and Lua have no job here. Hand-written assembly would only make the firmware harder to read: timing-critical LED output already runs in the RMT peripheral in hardware. Dart or Swift may earn a place later for a native mobile app, because iOS browsers have no WebMIDI.
