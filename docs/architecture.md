# Architecture

## The pieces

```text
                 +-------------------------- instrument ---------------------------+
                 | USB-MIDI | Bluetooth MIDI | 3.5 mm MIDI | audio (line or pickup)  |
                 +-------------------------------+---------------------------------+
                                                 v
+---------------------------------- hub (ESP32-S3) ------------------------------------+
|  inputs --> note bus (ring buffer) --> practice engine --> LED renderer --> LED bars   |
|                                    \--> session recorder --> MQTT publisher           |
+-------------------------------------------------+------------------------------------+
                                                  | Wi-Fi, MQTT
                                                  v
+-------------------------------- server (Docker Compose) ------------------------------+
|  Mosquitto --> ingest --> FastAPI --> Postgres + TimescaleDB (sessions, note events)   |
|                              |  \--> Redis queue --> worker (MIDI, audio, video import)|
|                              |  \--> MinIO (recordings, imported songs)                |
|                              \--> integrations: Spotify, WLED, Home Assistant, webhook |
+-------------------------------------------------+------------------------------------+
                                                  | HTTPS, WebSocket
                                                  v
+----------------------------------- Studio (browser) ---------------------------------+
|  WebMIDI and Web Bluetooth (direct to hub or instrument), practice view, library,      |
|  progress, hub setup                                                                   |
+---------------------------------------------------------------------------------------+
```

## Hub

The hub runs on an ESP32-S3 because it is the one widely available chip that combines a USB host port (to read and power a keyboard), Bluetooth LE (for Bluetooth MIDI and Synthesia) and Wi-Fi (for the server) with enough RAM for a full song.

- **Inputs** each run independently and push `NoteEvent`s onto one lock-free ring buffer, so a slow input never blocks the lights.
- **The practice engine** decides what each LED shows: played notes, the guide for the next notes, upcoming notes and wrong notes.
- **The LED renderer** maps notes to LEDs through the instrument profile and drives the bars through the RMT peripheral, which produces the WS2812B timing in hardware.
- **The session recorder** groups notes into sessions automatically. A session starts on the first note and ends after two minutes of silence.

## Server

- **FastAPI** exposes the HTTP API and the WebSocket feed the Studio uses.
- **Postgres with TimescaleDB** stores sessions and every note event. Note events live in a hypertable because a single session can produce thousands of rows.
- **Mosquitto** receives hub traffic on `melophos/<device_id>/<kind>` topics.
- **Redis and the worker** handle slow imports (audio transcription, video reading) away from the request path.
- **MinIO** stores recordings and imported files with an S3-compatible API.
- **Prometheus and Grafana** are an optional monitoring profile.

## Studio

A static TypeScript app that talks to devices directly in the browser through WebMIDI and Web Bluetooth. It needs no server for plain practice with a local instrument. It uses the server for the song library, practice history and progress.

## Shared pieces

- **The scoring engine** in `core/` is one Rust crate compiled to WebAssembly for the Studio and to a Python module for the server, so a performance gets the same score in both places.
- **Instrument profiles** in `profiles/` are read by every component, so a note maps to the same LED everywhere.
- **The protocol** in [protocol.md](protocol.md) is the contract between the hub, the server and the Studio.

The reasoning behind each choice is recorded in [decisions.md](decisions.md).
