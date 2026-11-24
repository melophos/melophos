# Firmware headers

| File | Purpose |
| --- | --- |
| `melophos_config.h` | Firmware version, pin assignments, LED limits and the update switch and its guard |
| `secrets.example.h` | The Wi-Fi update settings, the only thing a build can carry. Copy it to `secrets.h`, which is never committed |

Pins are defaults for the ESP32-S3. Each environment in `platformio.ini` overrides the pins that differ on its board through build flags.
