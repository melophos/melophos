// statements in the published documents that are tied to the code. tests/docs-claims.test.ts checks that each
// statement is still in its document and that each check still holds, so a document cannot keep describing a service
// that the repository does not have. the statement is a phrase that must appear in the document as written.

import type { Check } from "../lib/checks.ts";

export interface DocClaim {
  doc: string;
  statement: string;
  checks: Check[];
}

export const DOC_CLAIMS: DocClaim[] = [
  { doc: "docs/architecture.md", statement: "There is no WebSocket and no push channel", checks: [{ under: "server/app", absent: "[Ww]eb[Ss]ocket" }, { under: "studio/src", absent: "new WebSocket" }] },
  { doc: "docs/architecture.md", statement: "**FastAPI** exposes the HTTP API", checks: [{ file: "server/app/main.py", contains: "FastAPI(" }] },
  { doc: "docs/architecture.md", statement: "**Mosquitto** receives hub traffic", checks: [{ file: "server/deploy/docker-compose.yml", contains: "  mqtt:" }, { exists: "server/deploy/mosquitto" }] },
  { doc: "docs/architecture.md", statement: "Postgres 17", checks: [{ file: "server/deploy/docker-compose.yml", matches: "timescale/timescaledb:.*-pg17@sha256" }] },
  { doc: "docs/architecture.md", statement: "Every image in the compose file is pinned by digest", checks: [{ file: "server/deploy/docker-compose.yml", contains: "@sha256:" }, { file: "server/deploy/docker-compose.yml", contains: "MELOPHOS_SERVER_DIGEST" }] },
  { doc: "docs/architecture.md", statement: "A release installs published images with an installer script", checks: [{ exists: "server/deploy/install.sh" }, { exists: "server/deploy/pin-release.sh" }] },
  { doc: "docs/architecture.md", statement: "Until a release exists the stack is built on the machine", checks: [{ exists: "server/deploy/build-local.sh" }, { exists: "server/deploy/docker-compose.local.yml" }] },
  { doc: "docs/architecture.md", statement: "Backup and restore scripts are in the deploy folder", checks: [{ exists: "server/deploy/backup.sh" }, { exists: "server/deploy/restore.sh" }] },
  { doc: "docs/architecture.md", statement: "The worker** reads its queues from the database and has no other service behind it", checks: [{ exists: "server/worker/jobs.py" }, { under: "server/worker", absent: "[Rr]edis" }, { file: "server/deploy/docker-compose.yml", absent: "redis|minio" }] },
  { doc: "docs/architecture.md", statement: "Integration modules** for Spotify linking and WLED", checks: [{ exists: "server/app/integrations/spotify.py" }, { exists: "server/app/integrations/wled.py" }] },
  { doc: "docs/architecture.md", statement: "Signed webhooks for finished sessions are built", checks: [{ exists: "server/app/webhooks.py" }, { exists: "server/app/integrations/webhook.py" }] },
  { doc: "docs/architecture.md", statement: "**Prometheus and Grafana** are an optional monitoring profile", checks: [{ file: "server/deploy/docker-compose.yml", contains: 'profiles: ["monitoring"]' }] },
  { doc: "docs/architecture.md", statement: "the hub's broker password is derived from its secret and never sent", checks: [{ file: "server/app/security.py", contains: "def broker_password(device_secret: str)" }, { file: "server/app/security.py", contains: 'b"mqtt"' }] },
  { doc: "docs/architecture.md", statement: "does not use Web Bluetooth", checks: [{ under: "studio/src", absent: "navigator\\.bluetooth|requestDevice" }] },
  { doc: "docs/architecture.md", statement: "It connects to a keyboard through Web MIDI", checks: [{ file: "studio/src/midi-connection.ts", contains: "requestMIDIAccess" }] },
  { doc: "docs/architecture.md", statement: "with the WebAssembly build of the scoring engine", checks: [{ file: "studio/src/scoring.ts", contains: "@melophos/core" }, { exists: "core/wasm" }] },
  { doc: "docs/architecture.md", statement: "works offline through a service worker", checks: [{ file: "studio/src/app/update.ts", contains: "serviceWorker" }, { exists: "studio/sw.template.js" }] },
  { doc: "docs/architecture.md", statement: "installs from a manifest", checks: [{ exists: "studio/public/manifest.webmanifest" }] },
  { doc: "docs/architecture.md", statement: "The 3.5 mm MIDI jack, the USB-MIDI host and Bluetooth MIDI are written", checks: [{ exists: "firmware/lib/midi/midi.cpp" }, { exists: "firmware/lib/usbhost/usbhost.cpp" }, { exists: "firmware/lib/blemidi/blemidi.cpp" }] },
  { doc: "docs/architecture.md", statement: "Audio input has pins reserved and no firmware that reads it", checks: [{ file: "firmware/include/melophos_config.h", contains: "PIN_I2S_MCLK" }, { under: "firmware/lib", absent: "i2s_channel_read|i2s_read\\(|I2S\\.read" }, { under: "firmware/src", absent: "i2s_channel_read|i2s_read\\(|I2S\\.read" }] },
  { doc: "docs/architecture.md", statement: "lock-free ring buffer", checks: [{ exists: "firmware/lib/notebus" }] },
  { doc: "docs/architecture.md", statement: "drives WS2812B LEDs with FastLED", checks: [{ file: "firmware/src/leds.cpp", contains: "FastLED.addLeds<WS2812B" }] },
  { doc: "docs/architecture.md", statement: "The firmware checks signed updates and pairs with a code", checks: [{ exists: "firmware/lib/ota" }, { exists: "firmware/lib/pairing" }] },
  { doc: "docs/architecture.md", statement: "a batch every 250 ms", checks: [{ file: "firmware/lib/publish/publish.h", contains: "kBatchEveryMs = 250;" }] },
  { doc: "docs/architecture.md", statement: "ends after two minutes of silence", checks: [{ file: "firmware/lib/publish/publish.h", contains: "kIdleGapMs = 120000;" }] },
  { doc: "docs/architecture.md", statement: "Note events live in a hypertable", checks: [{ file: "server/db/migrations/001_initial_schema.sql", contains: "hypertable" }] },
];
