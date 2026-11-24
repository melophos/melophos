# Firmware tests

Unity tests for the libraries in [`../lib/`](../lib/), run on the development machine:

```bash
pio test -e native             # everything
pio test -e native-sanitize    # under AddressSanitizer and UndefinedBehaviourSanitizer
pio test -e native-release     # the release configuration: no plain MQTT
pio test -e native-tsan -f test_threads   # ThreadSanitizer on the two-thread test
MELOPHOS_FUZZ_SECONDS=60 pio test -e native-sanitize -f test_fuzz
```

Fakes for the clock, flash (with a power cut at any step), LED strip, USB power and port, Bluetooth, MQTT client, firmware slot and fetcher are in [`support/fakes.h`](support/fakes.h).

| Test | Covers |
| --- | --- |
| `test_keymap` | Black-key detection, per-key and strip mapping, range checks and reversed bars |
| `test_notebus` | Event ordering, overflow handling and the dropped-event counter |
| `test_profile` | Profile validation and limits, storage and its power cuts, the wear figures and the Studio commands |
| `test_practice` | The three modes, the lights without colour, the flash-rate limit, the current ceiling and the press-to-light timing |
| `test_audiogate` | Audio refused without the DC inlet, allowed with it, switched off when it goes |
| `test_guard2` | The three outputs as one frame (the ceiling is a total, the flash limits count across outputs, a 150 light strip cannot put the total over any ceiling, the floor edge at 511 mA, the estimate after the floor never over the ceiling) and the strip-level limit (30 falls and 3 large luminance rises over any second, summed across groups), scaling inside the guard, the re-show on a ceiling change, with an independent meter. Mutations of the thresholds and of `pending()` fail it |
| `test_encoder` | The encoder's quadrature decoder (every sample sequence up to 9 steps against an oracle) and the debounced switch with press and long press. Awaits a board |
| `test_buzzer` | The buzzer driver: off by default, longest sound, least gap, duty limit, never driven when a build claims the pin for JTAG. Awaits a board |
| `test_guard3` | An independent check of the guard written from the documents: the limits as plain numbers and the ceiling worked out from the supply setting, audio and inlet, at full brightness with the ceiling changing every pass and going to 0. Awaits a board |
| `test_clock` | The SNTP guard: build-time floor, a large jump held until a second answer agrees, the backlog kept meanwhile |
| `test_pins_bringup` | The classic ESP32 pin set and bench-supply rule (`native-bringup`) |
| `test_guard` | The flash limit at the sink driven from every input at 20 Hz, the current ceiling, the supply rating, the audio ceiling and the rail backstop |
| `test_netctl` | The network task's decisions against a model of the server: pairing, the broker only after the claim, the boot counter, the hourly cap across restarts, unclaim |
| `test_inlet` | The DC inlet rule: latched at start-up, dropped only under 3.0 V, SENSE_VIN as the authority and what an absent inlet turns off |
| `test_pins` | `melophos_config.h` against the hub board's pin table, line for line |
| `test_reset` | Factory reset erases the identity, profiles and the saved session and keeps the counters |
| `test_threads` | The queue and the status driven from two threads (run it under `native-tsan`) |
| `test_edge_cases` | Hostile and awkward cases across the modules: a malformed MQTT byte, odd profile shapes, a clock that is not at zero, small order keys, the boot counter's log and more |
| `test_midi` | The byte parser, USB-MIDI packets and Bluetooth MIDI framing |
| `test_usbhost` | Power cycling, enumeration time-outs, rejection and overcurrent |
| `test_blemidi` | Guide lights in, played notes out and the connection rules |
| `test_publish` | Topics, payloads against golden files, the offline queue, the link and the boot counter |
| `test_ota` | Every refusal of a manifest and an image, the trial and rollback machine and its power cuts |
| `test_mqttwire` | MQTT packets byte for byte, the client, keep-alive and the broker's faults |
| `test_identity` | Provisioning, validation, factory reset, pairing and certificate dates |
| `test_outbox` | The last session across a power cut, with a cut at every step and the wear figures |
| `test_release` | That a release build refuses plain MQTT (built by `native-release` only) |
| `test_fuzz` | Time-boxed fuzzing of every parser |

Other checks:

```bash
python ../profiles/check_profiles.py     # profiles and the invalid corpus against the schema
python contract_check.py                 # golden MQTT messages against the server's models
tools/check_signing.sh                   # the signing tool against the device's verifier (from the firmware folder)
python -m unittest installer/test_make_manifest.py
```
