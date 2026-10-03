# Support

## Getting help

- **Questions and ideas:** start a thread in [GitHub Discussions](https://github.com/melophos/melophos/discussions). This is the main help channel for build questions, setup problems and feature ideas.
- **Bugs:** open an issue on [melophos/melophos](https://github.com/melophos/melophos/issues) using the bug report form.
- **Security vulnerabilities:** never open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Anything else:** email contact@melophos.com.

## Self-help

- [README.md](README.md) for the overview and quickstart
- [docs/architecture.md](docs/architecture.md) for how the pieces fit together
- [docs/self-hosting.md](docs/self-hosting.md) for running the server stack
- [docs/instruments.md](docs/instruments.md) for instrument profiles and LED alignment
- [hardware/README.md](hardware/README.md) for the boards and the build

## Common issues

**The keyboard is not detected over USB.** The hub reads the 3.5 mm MIDI jack today. USB-MIDI, Bluetooth MIDI and audio input are still to come, see [What exists today](docs/architecture.md#what-exists-today). Once USB-MIDI lands, bear in mind that not every keyboard sends MIDI over its USB port, some only take power through it. Check it on a computer first: on macOS open Audio MIDI Setup and choose Window, Show MIDI Studio; on Windows any MIDI monitor will list it. If nothing appears, connect through Bluetooth MIDI, the MIDI jacks or the audio input instead.

**The lights drift out of line along the keyboard.** The profile's LED spacing does not match the bar or strip in use. See the alignment section of [docs/instruments.md](docs/instruments.md).

**Studio cannot see any MIDI device.** WebMIDI needs a secure context (`https://` or `localhost`) and a browser that supports it: Chrome, Edge or Firefox 108 and later, which asks for permission first. Safari does not support WebMIDI. Web Bluetooth, which Studio uses for Bluetooth MIDI, works only in Chrome and Edge.
