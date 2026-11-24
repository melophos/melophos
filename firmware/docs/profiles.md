# Profiles in flash

The hub keeps up to eight instrument profiles in flash, so changing instrument is a setting and not a rebuild. Status: builds for the board, tested on the host, awaits a board.

## What is stored

A profile is the document described in [`profiles/schema.json`](../../profiles/schema.json). The hub checks every profile that reaches it with the same limits as the schema and a few more that a schema cannot express.

| Limit | Value | Why |
| --- | --- | --- |
| Profiles kept | 8 | Two sectors each, 16 sectors in all |
| Profile document size | 1024 bytes | Bounds what a Studio message can ask the parser to read |
| Id | 1 to 32 characters, lower case letters and digits joined by single dashes | Used in topics and commands |
| Name | 1 to 64 characters | Shown in the Studio list |
| White key width | 5 to 50 mm | A bar cannot be laid out at 0 mm or 900 mm |
| Strip density | 10 to 300 LEDs per metre | |
| Offset | 0 to 32 LEDs | Negative offsets are refused |
| Strings | 1 to 8 | |
| Frets | 1 to 36 | |
| LEDs needed | 180 for a keyboard and 150 for a fretboard | The strip length the hub can drive |

A profile that needs more LEDs than the strip has is refused whole. The firmware never clips it, because a clipped profile lights the wrong keys without saying so.

## How it is written

Each profile has two sectors that take turns. A save erases the sector that does not hold the current copy and writes the new record there with the magic last. A record counts only when its magic, format version and CRC-32 agree and the newest valid one wins. A power cut at any point leaves either the old profile or the new one. The test cuts the power at every byte of a save and checks the result each time.

The active profile is a second small record in two more sectors, written the same way. If it names a profile that is missing the hub falls back to the built-in 88 key profile.

## Flash writes per day

A save is one sector erase and about 138 bytes programmed. A switch is one erase and about 30 bytes. An ordinary day is under 3 saves and 10 switches, so under 13 erases. The active pointer's two sectors share the switches, which is 5 erases each a day. A flash sector is good for about 100,000 erases, which is more than 50 years at that rate. The host test runs 100 such days and checks that no sector goes past that share.

## Asking the hub

The Studio sends one command per message. Until the transport lands the same commands work as lines on the serial port with the prefix `profile`.

| Command | Reply |
| --- | --- |
| `list` | `{"ok":true,"active":"piano-88","profiles":[{"id":"piano-88","name":"..."}]}` |
| `switch <id>` | `{"ok":true,"active":"<id>"}` |
| `put <profile json>` | `{"ok":true,"id":"<id>"}` |
| `remove <id>` | `{"ok":true}` |

Every failure is `{"ok":false,"message":"..."}` with a message a person can act on, for example `leds.offset must be a whole number from 0 to 32` or `the profile needs more LEDs than the hub can drive (180)`.

```text
profile switch piano-61
```

`factory-reset` on the serial port erases every stored profile along with the provisioning.

## Checks on the host

`pio test -e native -f test_profile` covers the shipped profiles, a corpus of 14 invalid profiles in [`profiles/invalid/`](../../profiles/invalid/), hostile JSON, every truncation of a good document, the limits, a power cut at every step of a save and a switch and a remove and the Studio commands. `python profiles/check_profiles.py` checks the same corpus against the schema.

## Not tested

Nothing has run on a board. Still to prove with one: that the `profiles` partition in [`partitions.csv`](../partitions.csv) is found at boot and that erasing and writing it works through the ESP-IDF partition API.
