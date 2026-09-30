# Licensing notice

MELOPHOS mixes software and hardware designs, so it carries two licences. This file explains which one applies where.

| Path | Licence | Licence file |
| --- | --- | --- |
| `hardware/` | CERN Open Hardware Licence v2, Strongly Reciprocal (CERN-OHL-S-2.0) | [`hardware/LICENSE`](hardware/LICENSE) |
| Everything else | GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) | [`LICENSE`](LICENSE) |

Each published component repository carries the licence file for its own folder, so a copy of `melophos/hardware` is covered by CERN-OHL-S-2.0 and every other component repository by AGPL-3.0-or-later.

Copyright (c) 2026 Isaac Adjei <https://isaacadjei.me>

## What the two licences mean in practice

- **Software (AGPL-3.0-or-later).** Anyone can use, study, modify and self-host MELOPHOS. Anyone who runs a modified version as a network service must make their modified source available to that service's users.
- **Hardware (CERN-OHL-S-2.0).** Anyone can build, modify, manufacture and sell boards made from these designs. Anyone who distributes a product based on a modified design must share the modified design files under the same licence.

## Third-party dependencies

MELOPHOS depends on third-party open-source packages that are pulled in at build time and are not vendored into this repository. They are declared in:

- `server/pyproject.toml` and `client/pyproject.toml` (Python packages)
- `studio/package.json` (npm packages)
- `firmware/platformio.ini` (firmware libraries and the ESP32 platform)

Each package is distributed under its own licence by its own authors.
