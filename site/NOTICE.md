# Notice

The site's own files are under the GNU Affero General Public License v3.0 or later, as the rest of the repository is
(see [NOTICE.md](../NOTICE.md) at the root). This file lists what else the site is built with.

## Sent to visitors

| What | Licence | Where it comes from |
| --- | --- | --- |
| Atkinson Hyperlegible Next, Atkinson Hyperlegible Mono and Melophos Music Signs (a subset of Bravura Text) | SIL Open Font License 1.1 | `studio/src/styles/fonts/`, with the licence texts and the sources. The site reads these files and keeps no copy |
| Phosphor Icons, bold weight, drawn into the pages as inline images | MIT | `@phosphor-icons/core`, through `studio/src/icons/` |
| React, React DOM and the Next.js browser runtime, which run the theme toggle, the keyboard figure and the picture of the Studio | MIT | `react`, `react-dom` and `next` |
| The Studio's keyboard and falling notes view, drawn on the home page | AGPL-3.0-or-later | `studio/src/instrument/`, imported directly |

No script, font, image or style from another origin is loaded. Apart from React, React DOM and Next.js, nothing in the
packages below is sent to a visitor.

## Used to build and check the site

Every version is pinned exactly in `package.json` and `package-lock.json`. All 550 or so packages in the tree are checked
against the licences the specification allows (`npm run check:licences`). The packages chosen directly:

| Package | Version | Licence |
| --- | --- | --- |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 |
| `@lhci/cli` | 0.16.1 | Apache-2.0 |
| `@phosphor-icons/core` | 2.1.1 | MIT |
| `@playwright/test` | 1.65.1 | Apache-2.0 |
| `@types/hast` | 3.0.5 | MIT |
| `@types/mdast` | 4.0.4 | MIT |
| `@types/node` | 26.6.6 | MIT |
| `next` | 16.4.6 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `axe-core` | 4.14.1 | MPL-2.0 |
| `github-slugger` | 2.0.0 | ISC |
| `license-checker-rseidelsohn` | 5.0.1 | BSD-3-Clause |
| `rehype-stringify` | 10.0.1 | MIT |
| `remark-gfm` | 4.0.1 | MIT |
| `remark-parse` | 11.0.0 | MIT |
| `remark-rehype` | 11.1.2 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |
| `unified` | 11.0.5 | MIT |
| `vitest` | 5.1.1 | MIT |

Packages below these that need a note are in `scripts/licences.allow.json`, each with a reason. One is
`@img/sharp-libvips-darwin-arm64` (LGPL-3.0-or-later), a binary that the Next.js image tool can load. The site turns
that tool off, does no image processing, the binary is never part of the output and nothing is distributed with it.

The published page `/licences/` shows the same information, generated at build time from the installed packages.
