# MELOPHOS site

The public website at melophos.com. A [Next.js](https://nextjs.org) app (App Router) exported as plain static files. It reads the repository
at build time, so each fact has one copy.

> [!NOTE]
> `site/` is not published to its own repository. It builds only inside the monorepo, because it reads `docs/`,
> `CHANGELOG.md`, `README.md`, `NOTICE.md`, `hardware/`, `assets/brand/` and the Studio's design files.

## Run it

```bash
cd site
npm ci
npm run dev        # development server
npm run build      # types, the export into out/ and every build check
npm run preview    # serve out/ on port 23190
npm run social     # draw the sharing card of each main page into public/social/
```

Node 24 or later. Next.js telemetry is switched off in every script. The build uses webpack (`next build --webpack`) because the Studio's icon module imports each icon with `?raw`.

## What is read from where

| The site shows | It reads |
| --- | --- |
| Colours, type scale, focus ring, base styles | `studio/src/styles/tokens.css` and `base.css`, imported directly |
| Fonts | `studio/src/styles/fonts/`, imported directly, with their licence texts |
| Icons | `studio/src/icons/index.ts` |
| Documents | `docs/*.md`, in the order of `docs/README.md`. Withheld ones are listed in `src/data/docs.config.ts` |
| What the Studio does | `src/data/studio-state.ts`, each statement with checks on the Studio's own code (`tests/studio-claims.test.ts`) |
| What the hub firmware does | `src/data/hub-state.ts`, the same way. Figures such as the LED current ceiling are read from the firmware source by `src/lib/facts.ts` |
| Statements in the published documents | `src/data/docs-claims.ts`, each tied to code (`tests/docs-claims.test.ts`) |
| Roadmap | `docs/roadmap.md`: `[x]` is Built and `[ ]` is Planned |
| Changelog and feed | `CHANGELOG.md`, minus the lines in `src/data/changelog.config.ts` |
| Bill of materials, power budget, board table | `hardware/bom/hub-rev-a.csv` and `hardware/README.md` |
| Light roles table, contrast figures | `studio/src/styles/lights.json`, `tokens.css` and `tokens.pairs.json` |
| What is built and the one list of status words | `src/data/status.ts`, each row with checks that read code. Every page and document uses these words |
| Brand files | `assets/brand/` |

Mermaid diagrams in the documents are shown as tables and lists. No script draws them.

### How the tokens and fonts are shared without drifting

The Studio and the site are two origins (D7) and the site keeps no copy of any design file. `src/app/layout.tsx`
imports `tokens.css`, `base.css` and `fonts.css` from `studio/src/styles/` and the build bundles them. A change to a
token reaches both surfaces at the next build. `tests/tokens.test.ts` fails if a copy appears in `site/` and
`tests/design-rules.test.ts` runs the Studio's own product rules (`studio/tests/lib/rules.ts`) over the site source,
including its list of allowed colour pairs. The Studio's contrast, colour vision and font tests measure the same files.

## Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` | A strict `tsc` over the app, then over the scripts and tests |
| `npm test` | Unit tests: every claim against the repository's code, a proof that each check fails when its property is false (`tests/checks.test.ts`), the figures read from their sources, the one status vocabulary, the privacy page's facts, the origin story, the writing rules, the headers file, the Markdown renderer, the product rules and the shared tokens |
| `npm run build` | Type check, the export, `scripts/finish-export.ts`, then `scripts/verify-dist.ts`: broken links and fragments, images with no alt text, third party requests, inline script and style, duplicate ids, one h1 a page, the sitemap, the writing rules, the figures each page must state, the status words and the owner placeholders |
| `npm run build:production` | The same checks. It fails while any owner placeholder is unfilled |
| `npm run check:licences` | Every package in the npm tree has an allowed licence |
| `npm run check:a11y` | Playwright and axe on every page: both themes, forced colours, more contrast, five widths, 200 per cent text, targets, text size, no two text boxes overlapping, scripts off, reduced motion, no third party request |
| `npm run check:live -- <address>` | Once the site is live: no injected script or cookie and the security headers present. See the hosting settings below |
| `npm run check:lighthouse` | Lighthouse CI budgets on the home page, a document and the hardware page |
| `npm run shots` | Screenshots of every page at 390, 768 and 1440 pixels in both themes |
| `npm run check` | All of the above |

From the repository root: `make lint` runs the type check, `make test-site` runs the unit tests and the build and
`make check-site` runs everything. The first browser run needs `npx playwright install chromium`.

## How the export stays plain files

`next build` with `output: "export"` writes every page as HTML into `out/`. Next.js writes its page data as inline
scripts, which the content security policy (`script-src 'self'`) would block, so `scripts/finish-export.ts` moves each one
into a file named by its hash under `_next/static/inline/` and loads it in the same place and order. It also adds the
preload for the reading font, removes the client navigation data files (every link is a plain link) and removes the two
extra copies of the not-found page. JSON-LD blocks stay in the page: the browser never runs them.

The brand files and the font licence texts are served by route handlers (`src/app/brand/`, `src/app/fonts/`) that read
`assets/brand/` and `studio/src/styles/fonts/` at build time, so the site keeps no copy.

The home page shows one still moment of the Studio drawn by the Studio's own code: `KeyboardView`
(`studio/src/instrument/keyboard-view.ts`) and `Lane` (`studio/src/instrument/lane.ts`), imported directly in
`src/components/StudioMoment.tsx` on the built-in piece Brother John.

## Owner placeholders

A fact the owner has to supply is a placeholder in `src/site.config.ts`. It shows as a marked, dashed sentence in a
development build and `npm run build:production` fails until it is filled. Today three are listed: the legal person responsible, the host of the Studio and the law that governs
the terms of use. Only the host of the Studio is still open. There is no postal address: the privacy page says email reaches us about everything. Each is listed on the privacy page and in `docs/community-privacy.md`, which uses the same marker text.
`scripts/verify-dist.ts` fails the build when a listed page stops showing one, so a row cannot be removed unnoticed.

## Deploying

The owner deploys. Upload `out/` to Cloudflare Pages by direct upload (D15). `out/_headers` carries the content
security policy and the other headers and `out/_redirects` sends `/try` to the app. Run `npm run build:production`
first.

## Hosting settings that keep the privacy page true

The privacy page says the site sets no cookie, runs no analytics and loads nothing from another origin. That holds only
while the hosting zone leaves these features off. They are on or easy to switch on in Cloudflare, so check each one in
the dashboard before the first deploy and after any change to the zone:

| Setting | Where | Must be | Why |
| --- | --- | --- | --- |
| Email Address Obfuscation | Scrape Shield | Off | It is on by default. It rewrites the contact address to "[email protected]" and adds a same-origin script (`/cdn-cgi/scripts/.../email-decode.min.js`) that the content security policy allows. With scripts off the address would not show |
| Web Analytics (and the automatic beacon) | Analytics and logs | Off for this site | It adds a script that measures visitors, which the page says does not happen |
| Zaraz and any tag manager | Zaraz | Not configured | It injects third-party tools into every page |
| Rocket Loader and Auto Minify scripts | Speed | Off | They rewrite or inject script and the policy allows no inline code |
| Cookies set by the host | Any | None | The page says the site sets none |

Once the live domain exists run the check against it. It fetches every page in the sitemap and fails when the response
holds an injected marker (`cf-email`, `email-decode`, `cloudflareinsights`, `zaraz`, a tag manager) or when a
security header is missing. It sends nothing anywhere:

```bash
npm run check:live -- https://melophos.com
```

The build cannot see the host, so this check is the only proof. A run that passes is what makes the privacy page true on
the day it goes live.

## Publishing steps

1. Fill every owner placeholder in `src/site.config.ts` (the host of the Studio) and the matching text in `docs/community-privacy.md`.
2. Run `npm run build:production`. It must pass.
3. Switch off the host settings in the table above, then deploy `out/`.
4. Run `npm run check:live -- https://melophos.com` and do not announce the site until it passes.

## Before publishing

A person reads every page against the status page (`/roadmap/#words`) and the repository. The guards are a net and not a
proof and no test can judge free prose. `src/lib/guards.ts` flags a sentence when all three hold. Its subject is the hardware: the hub, an LED bar or octave bar or light
bar, "the bars" or an end bar when the sentence is also about lights or keys, a hub board or circuit board or PCB, a kit or a
prototype. It has a verb of existing or working in the present or past tense. It has no word that makes it a plan, a design, a
condition or a denial. A musical bar ("bar 12", "two bars"), a quality bar ("set a bar", "misses its bar"), a board in the sense
of a budget, a unit of measure and a unit test are not hardware and are never flagged. It also flags fixed phrases such as
"ships", "in stock" and "tested on a real board". The failure message prints the whole sentence, the subject and the verb that
matched. To clear a flag reword the sentence with "is designed to" or add its words to `HARDWARE_ALLOWED` with a reason. It
reads words and not meaning. A false sentence that uses a hedge word, another noun or another verb passes and so does one with
the subject far from the verb. It prefers to miss an odd sentence than to flag a true one, because a false flag stops the people
who write the documents. A person reads every page. The other
tests catch a figure that differs from its source and a claim whose test has gone from the Studio, the firmware or the server.
They cannot catch a new sentence that is wrong in a new way, so look for any sentence that says something exists, works, ships
or has been tried that the status words do not allow. Nothing here has run on real hardware and no board has been made, so
every sentence about the hub is about firmware tested on a computer or about a design.
