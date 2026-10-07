# MELOPHOS Studio

The MELOPHOS browser app: practise with light guidance, manage the song library, review progress and set up the hub.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Run it

```bash
npm install
npm run dev
```

Open the address Vite prints, press **Connect MIDI device** and play: the on-screen keyboard follows every note.

> [!IMPORTANT]
> WebMIDI works in Chromium-based browsers (Chrome, Edge) and in desktop Firefox 108 and later. Firefox asks to install a site permission add-on the first time **Connect MIDI device** is pressed. Safari and Firefox for Android cannot reach MIDI devices. Web Bluetooth only works in Chrome and Edge. Both need `https://` or `localhost`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Unit tests with Vitest |
| `npm run build` | Type check, then a production build into `dist/` |

## Layout

See [`src/README.md`](src/README.md). The Studio is a static site, so `dist/` can be served from any static host.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
