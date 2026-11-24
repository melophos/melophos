# Firmware source

Board-specific code. Each file is a thin layer over a tested module in [`../lib/`](../lib/).

| File | Purpose |
| --- | --- |
| `main.cpp` | Setup and the main loop: poll inputs, run the practice hub, serial commands for bring-up, publish and trial health |
| `inputs.h`, `inputs.cpp` | Note sources: the MIDI jack and the USB host. Audio follows |
| `usb_host_esp.h`, `usb_host_esp.cpp` | USB-MIDI host on the ESP32-S3 over the ESP-IDF USB host driver and the VBUS switch |
| `ble_midi_esp.h`, `ble_midi_esp.cpp` | Bluetooth MIDI over NimBLE |
| `leds.h`, `leds.cpp` | Copies a finished frame to the three LED outputs (keys, frets, aux) through FastLED. The aux output gets data only up to its length in use. Awaits a board |
| `encoder_esp.h`, `encoder_esp.cpp` | Reads the rotary encoder pins every millisecond in a small task and queues the events from lib/encoder (oldest dropped when full). Compile-only. Awaits a board |
| `buzzer_esp.h`, `buzzer_esp.cpp` | The buzzer pin behind the BuzzerOutput seam. A sound is ended by a one-shot `esp_timer`, so it does not depend on the loop. The pin is reached only through a `SerialisedOutput` (a mutex), because the loop task and the timer task both call it. Uses the Arduino core 2.0.x LEDC calls `ledcSetup` and `ledcAttachPin`: `platform = espressif32@7.1.3` installs `framework-arduinoespressif32` 4.20017.260907, an Arduino core 2.0.x, whose `esp32-hal-ledc.h` declares both (checked in the installed package). Compile-only. Awaits a board |
| `storage_esp.h`, `storage_esp.cpp` | A named flash partition as the flash the profile store uses |
| `network_esp.h`, `network_esp.cpp` | Wi-Fi, the clock, pairing and the MQTT link on a task of their own. Idle until the hub is provisioned |
| `tls_transport.h`, `tls_transport.cpp` | TLS to the broker and the server with the certificate chain and dates checked |
| `kv_nvs.h`, `kv_nvs.cpp` | The provisioned settings in NVS |
| `ota_esp.h`, `ota_esp.cpp` | Wi-Fi update glue. Compiled only with `MELOPHOS_ENABLE_OTA` |

None of this has run on a board.
