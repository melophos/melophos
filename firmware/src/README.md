# Firmware source

Board-specific code that depends on the Arduino core.

| File | Purpose |
| --- | --- |
| `main.cpp` | Setup and the main loop: poll inputs, drain the note bus, update the lights, track the session |
| `inputs.h`, `inputs.cpp` | Note sources. The MIDI jack works today; USB-MIDI host, Bluetooth MIDI and the audio input follow |
| `leds.h`, `leds.cpp` | LED output through FastLED, with one colour per light role |
| `session.h`, `session.cpp` | Starts a session on the first note and ends it after two minutes of silence |
