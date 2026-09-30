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

## Build and flash

Install [PlatformIO](https://platformio.org/install/cli), then:

```bash
pio run -e esp32-s3                 # build
pio run -e esp32-s3 -t upload       # flash over USB
pio device monitor                  # serial log at 115200 baud
pio test -e native                  # unit tests on the host
```

## Layout

| Folder | Contents |
| --- | --- |
| [`include/`](include/) | Pin assignments and build-wide settings |
| [`lib/`](lib/) | Hardware-independent modules, unit tested on the host |
| [`src/`](src/) | Board-specific code: inputs, LED output, sessions and the main loop |
| [`test/`](test/) | Unity tests run by `pio test -e native` |

## Wiring for bring-up

| Signal | ESP32-S3 GPIO | Classic ESP32 GPIO |
| --- | --- | --- |
| Key LED data (through a 74AHCT125) | 4 | 4 |
| Fret LED data (through a 74AHCT125) | 5 | 5 |
| MIDI in (from the optocoupler) | 18 | 18 |
| MIDI out | 8 | 19 |
| I2S bit clock, word select, data | 15, 16, 17 | 15, 16, 17 |

> [!CAUTION]
> Never power a full LED bar from the development board's 5 V pin. Feed the bar from its own 5 V supply, join the grounds and put a 1000 uF capacitor across the bar's supply input.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
