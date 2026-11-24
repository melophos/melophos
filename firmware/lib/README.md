# Firmware libraries

Modules with no Arduino or ESP-IDF dependency, so they build and run on the development machine as well as on the hub. Anything that touches hardware sits behind a small interface in [`hal/`](hal/) and the board's side of it lives in [`../src/`](../src/).

| Library | Purpose |
| --- | --- |
| [`hal/`](hal/) | The seams (clock, flash, LED strip), CRC-32 and a bounded text writer |
| [`keymap/`](keymap/) | Maps a MIDI note to an LED index from an instrument profile, for per-key bars and fixed-density strips |
| [`notebus/`](notebus/) | Fixed-size ring buffer that carries note events from every input to the render loop without heap allocation and the set of guide notes a Bluetooth host asks for |
| [`jsonlite/`](jsonlite/) | A bounded JSON reader for documents that arrive from outside |
| [`profile/`](profile/) | Parses and validates a profile with the schema's limits and the strip length |
| [`profilestore/`](profilestore/) | Profiles in flash that survive a power cut at any step |
| [`profilecmd/`](profilecmd/) | The Studio's list, switch, put and remove commands |
| [`practice/`](practice/) | The Melody, Rhythm and Listen engine, the light renderer with its second signals and the current ceiling the output guard (flash limit and current ceiling at the sink) and the loop that ties them to the note bus |
| [`encoder/`](encoder/) | The rotary encoder: a quadrature decoder with detents, a debounced switch with press and long press and a short event queue that drops the oldest. Awaits a board |
| [`buzzer/`](buzzer/) | The buzzer driver: off by default, longest sound, least gap, duty limit, never driven when a build claims the pin for JTAG. Awaits a board |
| [`inlet/`](inlet/) | Whether the DC inlet is present, from SENSE_5V and the provisional SENSE_VIN |
| [`audiogate/`](audiogate/) | Audio input only while the DC inlet is present |
| [`netctl/`](netctl/) | The network task's decisions: pairing, when to connect, the boot counter and recovery |
| [`factoryreset/`](factoryreset/) | What a factory reset erases |
| [`midi/`](midi/) | MIDI byte parsing for the jack, USB-MIDI packets and Bluetooth MIDI framing |
| [`usbhost/`](usbhost/) | The USB host power and enumeration state machine |
| [`blemidi/`](blemidi/) | The Bluetooth MIDI link: guide lights in, played notes out |
| [`recordpair/`](recordpair/) | A small value in two flash sectors and a counter that never repeats across power cuts |
| [`publish/`](publish/) | MQTT topics, payloads, the offline queue and the QoS 1 delivery with back-off |
| [`mqttwire/`](mqttwire/) | MQTT 3.1.1 packets and a client over a transport seam |
| [`tlscheck/`](tlscheck/) | Certificate validity dates, checked by us because the core's mbedTLS does not |
| [`identity/`](identity/) | The provisioned settings, their validation and the `provision` commands |
| [`pairing/`](pairing/) | The pairing flow as a state machine |
| [`outbox/`](outbox/) | The last session kept in flash across a power cut |
| [`ota/`](ota/) | The update manifest check, the streaming image check and the trial and rollback machine |
| [`monocypher/`](monocypher/) | Third-party Ed25519 and SHA-512, vendored unchanged (see its README) |

Anything added here must stay free of hardware headers and come with tests in [`../test/`](../test/).
