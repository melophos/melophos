# Firmware headers

| File | Purpose |
| --- | --- |
| `melophos_config.h` | Firmware version, pin assignments, LED limits and buffer sizes |

Pins are defaults for the ESP32-S3. Each environment in `platformio.ini` overrides the pins that differ on its board through build flags.
