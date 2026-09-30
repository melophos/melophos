# Server application

| Module | Purpose |
| --- | --- |
| `main.py` | Builds the FastAPI app, CORS and routers |
| `config.py` | Settings from environment variables |
| `schemas.py` | Request and response models, matching the [protocol](https://github.com/melophos/docs/blob/main/protocol.md) |
| `stats.py` | Session summaries and per-key heatmaps from raw note events |
| `store.py` | Session storage behind a protocol. In memory today, Postgres next |
| `mqtt.py` | Validates hub topics of the form `melophos/<device_id>/<kind>` |
| [`routers/`](routers/) | HTTP routes |
| [`integrations/`](integrations/) | Spotify, WLED and webhooks, each off until configured |
