# Server application

| Module | Purpose |
| --- | --- |
| `main.py` | Builds the FastAPI app, migrations at start, CORS, the body size cap and the routers |
| `config.py` | Settings from environment variables |
| `db.py` | Connection pool and the migration runner (`python -m app.db`) |
| `schemas.py` | Request and response models, matching the [protocol](https://github.com/melophos/docs/blob/main/protocol.md) |
| `stats.py` | Session summaries and per-key heatmaps from raw note events |
| `store.py` | Sessions and note events in Postgres, with stable keyset pagination |
| `security.py` | argon2id passwords, token hashing, pairing codes and the shared rate limiter |
| `auth.py` | Who is calling and the `public`, `device` or `account` label every route carries |
| `accounts.py` | Users, sign-ins, devices and pairing codes |
| `limits.py` | Request body cap and the metrics token check |
| `mqtt.py` | Hub topic and payload checks with their bounds |
| `ingest.py` | Stores or skips each hub message and counts the outcome |
| `mqtt_runner.py` | The server's subscription to hub traffic |
| `broker.py` | Writes the broker's per-hub access rules |
| `webhooks.py` | Webhook endpoints, the delivery queue and the dispatcher |
| `outbound.py` | The only place the server calls an address a user chose, with the address checks |
| `midi.py` | The bounded MIDI file reader |
| `hands.py` | Hand split and difficulty |
| `songs.py` | The song library |
| `scoring.py` | The scoring interface, the worker's scoring job, the stand-in and the adapter for the Rust engine |
| [`routers/`](routers/) | HTTP routes |
| [`integrations/`](integrations/) | Spotify, WLED and the webhook payload and signature |
