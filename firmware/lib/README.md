# Firmware libraries

Modules with no Arduino or ESP-IDF dependency, so they build and run on the development machine as well as on the hub.

| Library | Purpose |
| --- | --- |
| [`keymap/`](keymap/) | Maps a MIDI note to an LED index from an instrument profile, for per-key bars and fixed-density strips |
| [`notebus/`](notebus/) | Fixed-size ring buffer that carries note events from every input to the render loop without heap allocation |

Anything added here must stay free of hardware headers and come with tests in [`../test/`](../test/).
