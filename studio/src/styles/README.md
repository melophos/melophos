# Design foundations

The tokens, fonts and base styles that the Studio and the public site share. The site reads these files from here and
keeps no copy.

| File | Purpose |
| --- | --- |
| [`tokens.css`](tokens.css) | Every colour, size, space, radius and duration as a custom property. Four colour sets: light, dark and a more contrast version of each |
| [`tokens.pairs.json`](tokens.pairs.json) | Every allowed pairing of a foreground and a background, with its role and the figure the specification prints |
| [`lights.json`](lights.json) | The role map for the lights: the shape and word that go with each colour, the nominal LED drive values and the firmware table as it stands |
| [`base.css`](base.css) | Reset, type, links, the focus ring and plain controls |
| [`fonts/`](fonts/README.md) | Self-hosted fonts, their licences, sources and checksums |
| `colour.ts`, `css-scan.ts`, `tokens-model.ts` | Read the files above. The tests and the specimen page use these, so they measure the same files the browser loads |

## Colour sets

`tokens.css` selects a set from the system setting (`prefers-color-scheme` and `prefers-contrast`) and from two optional
attributes on the root element: `data-theme="light"` or `"dark"` and `data-contrast="more"`. With no attribute the system
decides. `tests/e2e/specimen.e2e.ts` checks all 24 combinations of these.

The two more contrast sets are not in the specification. They raise muted text and marks to 7:1 and 4.5:1 and are
measured by the same test as the others.

## The lights

The rail is ink in every theme, as the real bar is. A colour never carries a state alone, so each light role has a shape
and a word in `lights.json`.

| Role | Screen token | Screen colour | LED drive, nominal | Firmware today |
| --- | --- | --- | --- | --- |
| Next note, right hand | `--light-right` | `#ffb000` | 255, 150, 0 | `GuideRight` 255, 150, 0 at 100 per cent |
| Next note, left hand | `--light-left` | `#7cc0ff` | 0, 110, 255 | `GuideLeft` 0, 110, 255 at 70 per cent |
| Coming up, right hand | `--light-right-soon` | `#a87400` | The same hue at about 12 per cent, gamma corrected | The guide colour at a lower level |
| Coming up, left hand | `--light-left-soon` | `#3f7fbf` | As above | The guide colour at a lower level |
| Wrong note | `--light-wrong` | `#ff6fa3` | 255, 0, 160 | `Wrong` 255, 0, 160 at 100 per cent |

The left hand is dimmer than the right on the bar as a second signal (70 per cent) and the Studio draws the left rail light and the left lane bars at 70 per cent too. A played note is amber at 55 per cent on the bar and an upcoming note is its hand's colour at 20 to 40 per cent. The names `kBlue`, `kAmber` and `kRed` in the firmware were kept and `kRed` now holds the rose-magenta, so `tests/lights.test.ts` maps the constants to roles in one place. The firmware now follows the same light language: amber for the right hand, blue for the left and a rose-magenta wrong light. `tests/lights.test.ts` fails when
`firmware/lib/practice/render.cpp` changes without this table, so the change is seen. LED values are tuned by eye on the real
diffuser and recorded with a photograph.

## Checks

| Script | What it guards |
| --- | --- |
| `npm run check:contrast` | Every listed pair meets the minimum of its role in every set. Every figure the specification prints is reproduced |
| `npm run check:vision` | Every pair of lights that can appear together differs by 20 or more in CIELAB under protanopia, deuteranopia and tritanopia |
| `npm run check:rules` | The product rules of section 4.2 of the specification, over the source |
| `npm run check:fonts` | Every required character has a glyph, the files match the checksums in the fonts README and the fallback metrics are current |
| `npm run check:licences` | Every package in the npm tree has a licence from the list in section 3.11 |
| `npm run check:a11y` | Playwright and axe on the specimen page: both themes, both contrasts, forced colours, reflow, targets, text size and reduced motion |
| `npm run check:lighthouse` | Lighthouse CI budgets on the specimen page |
