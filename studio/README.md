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
> WebMIDI and Web Bluetooth only work in Chromium-based browsers (Chrome, Edge) and only on `https://` or `localhost`. Safari and Firefox cannot reach MIDI devices.

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
