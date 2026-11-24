# MELOPHOS Studio

The MELOPHOS browser app: practise with light guidance, review your progress and connect a keyboard. It works with no hub, no account and no server.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Run it

The Studio uses the scoring engine from `core/`, built to WebAssembly. Build that package once before `npm install`, then run the app.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
(cd ../core/wasm/package && npm ci)
(cd ../core && sh wasm/build.sh)
npm install
npm run dev
```

Open the address Vite prints. Press **Try it with no keyboard** or choose a piece in the library. The on-screen keys, the home row of your computer keyboard (A to K, with Z and X for the octave) and a MIDI keyboard all play.

> [!IMPORTANT]
> Web MIDI works in Chromium-based browsers (Chrome, Edge) and in desktop Firefox 108 and later. Firefox asks to install a site permission add-on the first time **Connect a keyboard** is pressed. Safari and Firefox for Android cannot reach MIDI devices and neither can any browser on an iPhone or iPad, so there the on-screen keys are the way in. Both need `https://` or `localhost`. The Studio asks for MIDI only when you press the button, after a sentence that says what will be asked and why.

## What is in it

| Address (after `#`) | View | Needs a server |
| --- | --- | --- |
| `/` | Start: carry on with the last piece or begin | No |
| `/try` | The practice view with a simulated player, labelled Simulated | No |
| `/library?q=&sort=` | Pieces as rows, search and sort held in the address and import of a MIDI file | No |
| `/piece/:id` | One piece with its past sessions. An imported piece also has the hand editor and, when a server is linked, the send panel | No. Sending a piece and its hands needs your own server |
| `/practise/:id?mode=&hand=&from=&to=&tempo=&loop=&view=` | The practice view | No |
| `/game/:id?tempo=&hand=&from=&to=` | The rhythm game on one piece | No |
| `/bests` | Personal bests of the rhythm game | No |
| `/progress` and `/progress/:id` | Days practised, charts with tables, the keys that went wrong | No. Sessions from your own server can be added |
| `/devices` | The MIDI connection in every state, an activity light, input choice and calibration. With a server linked, pairing by code | No. Pairing needs your own server and has not run with a real hub |
| `/settings/display`, `/notes`, `/sound`, `/input`, `/data`, `/server` | Settings, export, import and delete and the optional link to your own server | No. The server link is optional |
| `/about`, `/diagnostics` | Version and source, then the scoring self-check and timing figures | No |

The addresses use the hash, so the built `dist/` is plain static files that any host can serve with no rewrite rules.

- **Modes.** Melody waits for the right note and shows the step view (the next note large, two smaller after it). Rhythm and Listen show falling notes on a canvas above the keyboard. Either guidance can be chosen in any mode.
- **Practice controls.** Speed from 25 to 125 per cent, one hand or both, a range of bars, a loop, a one bar count-in, a metronome with an accented first beat, repeat or skip a phrase and pedal or key control (Space, Page Up and Page Down, the arrows, the sustain pedal).
- **Light language.** Next note and right hand are amber with a disc. The left hand is blue with a square and is drawn at 70 per cent brightness. Coming up is a ring or a hollow square. A wrong note is rose-magenta with a cross and the words "wrong note". A right note puts the light out. These are decision D4 and the hub firmware uses the same table (`src/styles/lights.json`, checked by `tests/lights.test.ts`): amber for the right hand, blue for the left, rose-magenta for a wrong note, the left hand dimmer on the bar and no blinking with reduced motion. A wrong light is on the key pressed and never on the guide key.
- **Scoring.** Every accuracy figure comes from the WebAssembly engine, so the browser and the terminal give the same score. The Studio decides only which note is next. Counts come first and timing is shown only in Rhythm mode after calibration, rounded to 10 ms.
- **Importing a MIDI file.** The file is read in the browser with the server's own limits (1 MiB, 32 tracks, 300 000 events, 50 000 notes, 2 hours) and nothing from the file is trusted. A file it cannot read gets a plain reason. The reader is checked against the server's reader on 40 seeded files and fuzzed (`npm run fuzz:midi`, 120 seconds, seeded).
- **Hands.** The split of an imported piece into left and right is always called a first guess, using the server's rules. You can correct it note by note or with a split point, undo one step at a time and go back to the guess. Corrections are kept in the browser with the piece. A built-in piece keeps the hands it was written with.
- **Offline and install.** A hand-written service worker keeps one versioned cache of every built file, including the WebAssembly module, so practice, the library and the record need no network after the first load. A request to any other origin, such as your own server, is never touched or cached. A new version waits and is offered with an Update button that is refused while a piece is running. There is a web app manifest that starts in landscape.
- **Your own server (optional).** Set its address under Settings, Your server. Then Devices can pair a hub with the code it shows, an imported piece can be sent and its corrected hands sent (`GET /api/v1/songs/{id}/notes`, `PUT /api/v1/songs/{id}/hands`, `POST .../hands/reset`) and sessions can be read with their score state (pending, scored or failed, never a number that has not arrived). Under Settings, Your server, the sign-in token belongs to the address that issued it and is dropped with everything read from it when the address changes. The page shows the storage used on the server and says plainly when recording has stopped because it is full. The same page has "Delete your data on the server": sign out everywhere, delete the account with its password and, from Progress, delete one session, each behind a confirmation that says what goes and that it cannot be undone. Devices lists the hubs on the account so one nobody expected can be removed. The Studio has no sign-up form and never says whether an address is already registered. It does not manage webhooks. A sign-in token stays in memory only. These are built from the server's documents and run only against a fake server in the tests, not a real one. The server's CORS now allows PUT, but that was not tried here. If a browser blocks a call the Studio says which call needs which method.
- **Data.** Sessions, imported pieces and settings stay in this browser (IndexedDB and local storage). A run played by the simulator is never saved. There is export of the sessions, import (all or nothing, in one transaction) and delete everything, which removes the database itself, the settings, the cached files and the service worker and says it is done only after looking that they are gone. Nothing is sent anywhere unless you link your own server and press a button.

## The rhythm game

The rhythm game (`/game/:id`) plays a piece once through in Rhythm mode with the notes falling to the keys. The player chooses a difficulty: the tempo (25 to 125 per cent of the written speed), the hand (both, left or right) and optionally a range of bars. None of these changes how strictly a note is judged: the engine judges every note the same way at every setting. The game makes no sound unless the player turns on "Sound in the game", has no countdown that needs a quick reader (the piece begins when Start is pressed and can be paused at any time), has no streak and no comparison with other people and the phrase jumps and the pedal's repeat are off.

### How a game result is derived

A game result is the scoring engine's summary of the run and nothing else. The Studio adds no points, stars, levels or scoring rules. The run is scored once by the engine (the same call as a Rhythm practice session) and the page shows these fields:

| On the page | Field of the engine's summary |
| --- | --- |
| Accuracy | `playedAccuracy`: hits over the notes in the hands played plus wrong presses, shown as a percentage to one decimal place |
| Notes hit, out of | `hits`, out of `playedExpected` |
| Notes hit late | `late` |
| Notes missed | `misses` |
| Wrong keys pressed | `wrong` |
| Keys not judged | `unsure`, the presses the engine could not place with confidence. They count neither for nor against the player and never change a best |

`src/game.ts` (`resultFrom`) copies these fields and `src/game.test.ts` checks it. The one sentence about the best compares two engine accuracies. Every use of the engine goes through `src/scoring.ts`, the one adapter.

- A press is read there as right (`hit`, `late` or `repeat`), wrong or not judged (`unsure` or any outcome the Studio does not know). A replayed note after Repeat phrase or Next phrase is right for the note it repeats. An extra strike of a note that was already played also shows as right and builds no run because it was already counted.
- An unsure press is shown with its own icon, its own words ("Not judged") and a dashed outline on the key with a diamond on the rail. It is not announced, it builds no run and breaks none and it counts neither for nor against the player in the summary or the game.
- The engine is told the hand or hands practised and that play starts at the beginning of the stretch. Each Repeat or Next phrase opens a new stretch with a new live session. The whole run is scored once, with every stretch after the first told to the engine as a jump. The practice slices the piece to the chosen hand, so the engine never sees the other hand's notes.
- A press shown wrong is shown at once and is taken back if the engine reads it differently later. The spoken "Wrong. Still C 4." waits until the engine has made the press final, because speech cannot be taken back.
- If the engine refuses a run (a bad jump or a hand with no labelled notes) the page says so in the engine's words, keys are checked by the plain rule and there is no accuracy figure.
- The timing window is the engine's own: the Studio no longer widens it for slow practice. Melody mode, where timing is not judged, keeps the widest window.
- No text or rule in the game assumes a fixed timing window.

### Personal bests

A personal best is the highest engine accuracy for the same song, the same hand, the same tempo and the same range of bars, from the same build of the scoring engine. A result equal to the best does not replace it. A best at 60 per cent tempo with one hand never replaces one at full tempo with both: each setting has its own best and is stored with its settings. The first result for a setting is its best so far.

Each best also stores the version of the engine that judged it: a short hash of the WebAssembly module (`src/engine.ts`, `scripts/engine-version.ts`), because the package's version number has stayed the same while the engine's judgement changed. When the engine changes, old bests are kept, marked as from an earlier version, shown apart under "Earlier results" and never compared with new ones.

Bests live in the browser's own record (IndexedDB, store `bests`) beside the sessions. They go with the export, the import (in the same single transaction as the sessions) and "Delete everything". A game run is also recorded as an ordinary Rhythm session. No game result is sent anywhere: with an own server linked, a game session is not sent or changed in any way. A server that held bests would need a new field on the session or a new route, which is a contract change for the server's builder.

The page says in plain words that a best is only what the scoring engine thinks.

## Content security policy

The built page carries `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'`, `manifest-src 'self'`, `style-src 'self'` with one hash, `style-src-attr 'unsafe-inline'`, `img-src 'self' data:`, `font-src 'self'` and `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`. The WebAssembly scoring engine needs `wasm-unsafe-eval` and nothing else needs unsafe code. The service worker needs `worker-src 'self'` and the manifest `manifest-src 'self'`. The service worker script is not governed by the page's meta tag, so a host should also send the same policy as a header. `connect-src` allows https anywhere and plain http on this machine only, because that is the whole set of addresses a player's own server can have. A host that never wants a server link can narrow it to `'self'`.

## Keys, the size of the targets and a recorded exception

Where the on-screen keyboard is an input, a white key is 44 px wide at the Near setting (2.75 rem, measured 44 px at the default text size) and wider at Stand and Far. The range scrolls inside its own frame, so keys are never made narrower to fit. A black key cannot be 44 px wide on a real keyboard's proportions. Its drawn width is 0.6 of a white key (26.4 px at Near) and it has a wider hit area of 0.72 of a white key (31.7 px at Near) and 103 px tall, which is as wide as the neighbouring white keys allow. This is a recorded exception to the 44 px width target. A test measures it at 390, 768 and 1440 px. Every note can also be entered another way: the home row of the computer keyboard plays a little over an octave with Z and X moving the octave and the arrow keys with Space or Enter move between and press every key on screen.

## What a host must send

`npm run build` writes `dist/_headers`, which Cloudflare Pages and Netlify read as it is. It carries the same content security policy as the page's meta tag with `frame-ancestors 'none'` added (a meta tag cannot set it), a separate policy for `/sw.js` (the worker file is not governed by the page's meta tag), `X-Content-Type-Options`, `Referrer-Policy`, a `Permissions-Policy` that grants MIDI to the app only and long caching for the hashed files in `/assets/`. Any other host must send those headers itself and must serve `sw.js` with `Cache-Control: no-cache` so a new build is seen. The specimen page has its own, stricter policy.

## Spoken note names

The Studio offers them once at first run and in Settings, Sound. It uses only a speech voice the browser marks as running on this device. If there is none it says so and speaks nothing. A player can allow an online voice after being told that the words, which are note names, go to the browser's speech service. A wrong note is announced to a screen reader as "Wrong. Still C 4." at most once every two seconds. Right notes are not announced.

## Claims that a test proves

- **The Studio requests nothing but the address the player saved for their own server.** `tests/e2e/app-network.e2e.ts`, "the Studio requests nothing but the saved server address". It records every request of the page and its worker across every view and the own-server features and fails on any request to another origin. A saved server is not called until a button is pressed.
- **The service worker never touches a request to another origin and never caches a signed-in answer.** `tests/e2e/app-hardening.e2e.ts`, "the service worker never touches a request to another origin and never caches a signed-in answer". It is a behaviour test in a browser against a second origin.
- **No token is written to storage.** `src/app/serverLink.test.ts`, "is never written to storage".
- **Spoken note names use a voice on this device unless an online one is allowed.** `src/speech.test.ts`.

## Browsers tested

Only Chromium (the Playwright build, 24 browser tests on desktop and the Lighthouse runs) has been tested, on one Mac. Firefox and WebKit are not installed here and have not been tried. Safari and every iPhone or iPad browser have no Web MIDI, so on those the on-screen keys and the computer keyboard are the way in and the Studio says so. Web MIDI is only requested when a button is pressed, after a plain sentence about what will be asked. Where it is missing or refused every other part of the Studio still works. Web Bluetooth is not used. Screen Wake Lock, speech, IndexedDB and the service worker are each checked for and the Studio carries on without any of them.

## Not built yet

- Hub control, the fit wizard and the firmware installer: they need the protocol and firmware work in stages 12 to 15. The hub notice for a hub in development mode (an unencrypted connection) is designed and shows nothing until a hub reports it. Anything that talks to a hub is untested with hardware.
- Spoken note names are built but need a screen reader and speech voice check by a person.
- Practising one hand of a two-hand piece passes the scoring engine only that hand's notes. The engine is being reworked for this case, so those figures depend on the reworked engine.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Unit tests, the contrast, colour vision, product rules and font checks and a 3 second fuzz of the MIDI reader |
| `npm run fuzz:midi` | The same fuzz for 120 seconds |
| `npm run build` | Type check, then a production build into `dist/` with a content security policy that allows WebAssembly |
| `npm run specimen` | The design specimen page on port 5180 |
| `npm run specimen:shots` | Screenshots of the specimen at three widths, both themes, forced colours and zoom |
| `npm run check:a11y` | Playwright on the specimen and on the built app: flows, axe, sizes, reflow, reduced motion and timing |
| `npm run check:lighthouse` and `npm run check:lighthouse:app` | Lighthouse budgets on the specimen and on the app |
| `npm run check` | Every check |

`npm run check:a11y` needs a browser: run `npx playwright install chromium` once.

## Budgets and measured figures

| Budget | Limit | Measured here |
| --- | --- | --- |
| Shell and practice route script | 150 kB compressed | 108.4 kB (with the progress view) |
| WebAssembly module | 100 kB compressed | 34.9 kB |
| Press to drawn frame, 95th percentile at 60 Hz | 20 ms | 14 ms (Chromium on a Mac, synthetic presses) |
| Lane frame interval, 4 times CPU slowdown, 95th percentile | 18 ms | 16.7 ms over 10 s |

These measure the browser only. Key to screen and key to light need a phone filming at 240 frames a second and a real hub. Nothing here has run on real hardware or on a tablet.

## Layout

See [`src/README.md`](src/README.md). The Studio is a static site, so `dist/` can be served from any static host.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
