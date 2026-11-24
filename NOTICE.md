# Licensing notice

MELOPHOS mixes software and hardware designs, so it carries two licences. This file explains which one applies where.

| Path | Licence | Licence file |
| --- | --- | --- |
| `hardware/` | CERN Open Hardware Licence v2, Strongly Reciprocal (CERN-OHL-S-2.0) | [`hardware/LICENSE`](hardware/LICENSE) |
| Everything else | GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) | [`LICENSE`](LICENSE) |

Each published component repository carries the licence file for its own folder, so a copy of `melophos/hardware` is covered by CERN-OHL-S-2.0 and every other component repository by AGPL-3.0-or-later.

Copyright (c) 2026 Isaac Adjei <https://isaacadjei.me> & <https://melophos.com>

## What the two licences mean in practice

- **Software (AGPL-3.0-or-later).** Anyone can use, study, modify and self-host MELOPHOS. Anyone who runs a modified version as a network service must make their modified source available to that service's users.
- **Hardware (CERN-OHL-S-2.0).** Anyone can build, modify, manufacture and sell boards made from these designs. Anyone who distributes a product based on a modified design must share the modified design files under the same licence.

## Third-party dependencies

MELOPHOS depends on third-party open-source packages that are pulled in at build time and are not vendored into this repository, apart from the fonts listed below. They are declared in:

- `server/pyproject.toml` and `client/pyproject.toml` (Python packages)
- `studio/package.json` and `site/package.json` (npm packages, the site ones are listed with their licences in `site/NOTICE.md`)
- `discord/requirements-dev.txt` and `discord/worker/package.json` (Python and npm packages for the Discord tooling)
- `firmware/platformio.ini` (firmware libraries and the ESP32 platform)

Each package is distributed under its own licence by its own authors.

The Studio ships React and React DOM (MIT), React Aria Components with its React Aria and React Stately packages (Apache-2.0) and the scoring engine package `@melophos/core` from `core/wasm/` (AGPL-3.0-or-later, a 38 KB WebAssembly module and its loader). `studio/scripts/check-licences.ts` fails the build when any package in the Studio's tree carries a licence outside the allowed list.

## Vendored code

`firmware/lib/monocypher/` holds Monocypher 4.0.2 by Loup Vaillant and contributors, unchanged, for the firmware's update signature check. It is dual licensed under the 2-clause BSD licence or CC0, see `firmware/lib/monocypher/LICENCE.md`.

## Bundled fonts

The Studio and the public site serve three font files from `studio/src/styles/fonts/`. Each is under the SIL Open Font
License 1.1 and keeps its licence text beside it. Sources, versions and checksums are in the README in that folder.

- **Atkinson Hyperlegible Next** and **Atkinson Hyperlegible Mono**, from the Atkinson Hyperlegible Next project authors.
- **Melophos Music Signs**, a subset of Bravura Text by Steinberg Media Technologies GmbH. It holds the sharp, flat and natural signs only and is renamed because Bravura is a reserved font name.

## Icons

The Studio icons are from Phosphor Icons, bold weight, under the MIT licence.
