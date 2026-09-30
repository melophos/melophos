# Contributing

Thanks for taking an interest in MELOPHOS. Contributions are welcome across every part of the platform: firmware, hardware, the server, the Studio app, instrument profiles and documentation.

## Where to start

- **Instrument profiles** are the easiest first contribution. If your keyboard or guitar is not covered, add a profile under [`profiles/`](profiles/) that validates against [`profiles/schema.json`](profiles/schema.json).
- **Bugs** with a clear reproduction are always welcome, especially hardware-specific ones (a keyboard that does not enumerate over USB-MIDI, a strip density that drifts).
- **Larger features** should start as a discussion or an issue first, so the design can be agreed before code is written. [docs/roadmap.md](docs/roadmap.md) lists what is already planned.

## How to contribute

1. Fork `melophos/melophos` and create a branch named `feat/<short-description>` or `fix/<short-description>`.

   > [!IMPORTANT]
   > Always work against `melophos/melophos`. The component repositories (`melophos/firmware`, `melophos/server` and the rest) are read-only copies published from this repository, so pull requests opened there cannot be merged.

2. Make your change. Keep it focused on one thing.
3. Run the checks for every component you touched:

   ```bash
   make lint
   make test
   ```

4. Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) if the change is user-facing.
5. Open a pull request with a clear title and a description of what changed and why. Link the issue it closes.

## Style

- **Comments** explain why, not what.
- **UK English** in documentation and comments.
- **Commit subjects** use the conventional style: `feat:`, `fix:`, `docs:`, `chore:`, imperative and under 72 characters.
- **Python** is formatted and linted with Ruff. **TypeScript** is type-checked with `tsc`. **C++** follows the existing firmware layout, one module per responsibility.
- **Hardware** changes include the KiCad sources, never only exported Gerbers.

## Reporting bugs

Open an issue using the bug report form. Include the component, the hardware involved (hub revision, instrument model and how it connects), what you expected and what actually happened.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before taking part. More about the maintainer: [isaacadjei.me](https://isaacadjei.me).
