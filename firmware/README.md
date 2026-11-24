# MELOPHOS hub firmware

Firmware for the MELOPHOS hub: reads notes from the instrument, lights the matching keys or frets and records practice sessions.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Build environments

| Environment | Board | What it is for |
| --- | --- | --- |
| `esp32-s3` | ESP32-S3-DevKitC-1 and the rev A hub | The real hub, with USB host |
| `esp32-bringup` | Any classic ESP32 dev board | Early LED, MIDI jack, Bluetooth and Wi-Fi work. No USB host |
| `native` | The development machine | Unit tests for everything in `lib/` |
| `native-sanitize` | The development machine | The same tests under the address and undefined behaviour sanitizers |

## Build and flash

Install [PlatformIO](https://platformio.org/install/cli), then:

```bash
pio run -e esp32-s3                 # build
pio run -e esp32-s3 -t upload       # flash over USB
pio device monitor                  # serial log at 115200 baud
pio test -e native                  # unit tests on the host
pio test -e native-sanitize         # the same under the sanitizers, with the fuzz targets
```

> [!NOTE]
> Nothing here has run on a hub board. Every feature builds for the board and is tested on the host. Each document under [`docs/`](docs/) lists what that leaves untested and a bring-up checklist for the day a board exists.

## Features and their documents

| Feature | Document |
| --- | --- |
| Profiles in flash and the Studio commands | [`docs/profiles.md`](docs/profiles.md) |
| Melody, Rhythm and Listen modes, the lights, the 2700 mA LED ceiling and the audio gate that needs the DC inlet | [`docs/practice-modes.md`](docs/practice-modes.md) |
| USB-MIDI keyboards | [`docs/usb-midi.md`](docs/usb-midi.md) |
| Bluetooth MIDI | [`docs/bluetooth-midi.md`](docs/bluetooth-midi.md) |
| Publishing sessions over MQTT | [`docs/mqtt.md`](docs/mqtt.md) |
| Wi-Fi updates and the browser installer | [`docs/updates.md`](docs/updates.md) |
| Pins, power, the three LED outputs, the encoder, the buzzer and the supply rating | [`docs/pins-and-power.md`](docs/pins-and-power.md) |

## Settings, secrets and what a hub holds

Nothing about an owner's network or a hub's identity is compiled in or committed. Wi-Fi, the broker, the certificate authority and the device identity are given to the hub at run time and kept in its storage. The `provision` serial commands are in [`docs/mqtt.md`](docs/mqtt.md). A build can carry only the Wi-Fi update settings, in `include/secrets.h` copied from [`include/secrets.example.h`](include/secrets.example.h). Wi-Fi updates are off unless a build defines `MELOPHOS_ENABLE_OTA`.

The hub talks to the broker over TLS and verifies the broker's certificate. Plain MQTT exists only in a development build, behind a flag the owner must switch on, shown by a glow on the light bar and is not compiled into a release build.

> [!WARNING]
> Flash encryption is off. Anyone who can connect a cable to a hub can read its flash and get the Wi-Fi password, the device secret that is its identity on the broker, the certificate authority, the stored profiles and the notes of the last session. Remove a stolen hub in the Studio. `factory-reset` on the serial port erases the Wi-Fi, broker, certificate authority and device identity, every stored profile and the saved last session and clears the Wi-Fi driver's own store (the driver is never allowed to keep a copy of the password). It keeps the boot counter and the update version floor. A test checks the outbox is blank afterwards.

Recovery. If the hub's boot counter is lost (or the server's range check refuses its boot) it says so on serial and does not publish, because any number it chose could be refused for ever. Run `factory-reset` and pair it again as a new device or have the owner rotate the hub's secret in the Studio (that clears what the server remembers) and enter the new one with `provision device <id> <secret>`. Anyone who reads the pairing code off a hub can claim it: the owner should check who the hub says claimed it and send `unclaim` on the serial port within 15 minutes if it is wrong.

Practice sessions are saved to flash when they end and sent again after a power cut, up to 1000 notes of the last session. Anything older than that or from a session whose date could not be known, is lost. A power cut during delivery can store the last notes of a session twice.

## Flash wear

Every store is bounded, with the worst case a hostile sender could force. A flash sector is good for about 100 000 erases.

| Store | What writes it | Limit | Erases per sector per day at the limit | Lifetime at the limit |
| --- | --- | --- | --- | --- |
| Boot counter (4 KiB sectors, 8 byte records) | One increment and only when a boot first reaches the broker (never at power-up). A counter whose sector header is damaged is lost and the hub does not publish. A flipped bit in a record counts as a used number, so the counter never goes back | None needed: 511 increments per erase over two sectors | 1 per 1022 boots. At 1 boot a second, 85 a day | 1180 days |
| Outbox, the last session | A session that ends | One save every 10 minutes, so 144 a day. Each save erases 2 sectors, over 4 sectors | 144 x 2 / 4 = 72 | 100 000 / 72 = 1388 days (3.8 years) |
| Profile save | `profile put` | One a minute, so 1440 a day, over the profile's 2 sectors | 720 | 139 days |
| Profile switch | `profile switch` | One every 2 seconds, so 43 200 a day, one erase per 1022 appends | 42 | 2400 days (6.5 years) |
| Update trial record and floor | An update (off by default) | Rare | negligible | |

An ordinary day (3 saves and 10 switches) uses 3 erases. Before these limits the boot counter erased a sector every boot (about 2.3 days at 1 Hz), a sender at jack rate wore the outbox in about 70 days and `profile switch` in a loop wore its sectors in about 1.5 hours. A save of the outbox blocks the main loop for about 100 ms.

## Layout

| Folder | Contents |
| --- | --- |
| [`include/`](include/) | Pin assignments and build-wide settings |
| [`lib/`](lib/) | Hardware-independent modules, unit tested on the host |
| [`src/`](src/) | Board-specific code: the seams to flash, USB, Bluetooth, Wi-Fi and the LEDs and the main loop |
| [`test/`](test/) | Unity tests run by `pio test -e native`, with fakes in `test/support/` |
| [`docs/`](docs/) | One page per feature with its limits, its proof and what a board still has to show |
| [`tools/`](tools/) | The update signing tool |
| [`installer/`](installer/) | The browser installer page and the script that builds its manifest |

## Wiring for bring-up

| Signal | ESP32-S3 GPIO | Classic ESP32 GPIO |
| --- | --- | --- |
| Key LED data (through a 74HCT125) | 4 | 4 |
| Fret LED data (through a 74HCT125) | 5 | not driven (key strip alone) |
| Third LED output, encoder, buzzer (awaits a board) | 38, 47, 48, 14, 40 | not fitted |
| MIDI in (from the optocoupler) | 18 | 18 |
| MIDI out | 8 | 19 |
| I2S bit clock, word select, data | 15, 16, 17 | 15, 16, 17 |

> [!IMPORTANT]
> The third LED output on connector J14 supports a strip of at most 150 lights (a placeholder until the owner gives the real figure). The length in use is a stored setting, default 60. The guard reserves the idle draw of 150 lights whatever length is in use. A longer strip is not supported and the firmware cannot detect one, because the strip sends nothing back: only the board's resettable fuse and the budget's margin stand behind it. See [`docs/pins-and-power.md`](docs/pins-and-power.md).

> [!CAUTION]
> Never power a full LED bar from the development board's 5 V pin. Feed the bar from its own 5 V supply, join the grounds and put a 1000 uF capacitor across the bar's supply input.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
