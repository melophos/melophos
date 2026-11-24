# Deploy

Docker Compose stack for self-hosting. Full instructions are in [self-hosting.md](https://github.com/melophos/docs/blob/main/self-hosting.md).

| Service | Image | Purpose |
| --- | --- | --- |
| `db` | `timescale/timescaledb` | Postgres with TimescaleDB |
| `mqtt` | built from `mosquitto/` | Broker the hubs publish to, with a login for every paired hub |
| `db-roles` | built from `..` | One-shot on every start: makes the owner and application roles with exactly their rights. The only service besides the database that sees the superuser login |
| `migrate` | built from `..` | One-shot on every start: applies migrations as the owner (not a superuser). The only service that sees the owner login |
| `server` | built from `..` | The API. Starts after `migrate`, with the limited role only |
| `worker` | built from `..` | Webhook delivery, song import and session scoring |
| `prometheus`, `grafana` | official images, pinned by digest | Optional, with `--profile monitoring`. Both listen on this machine only. Grafana has no default password: set `GRAFANA_ADMIN_PASSWORD`. Prometheus reads `monitoring/metrics_token`, which must hold `METRICS_TOKEN` |

| Folder | Contents |
| --- | --- |
| [`mosquitto/`](mosquitto/) | Broker image and configuration |
| [`monitoring/`](monitoring/) | Prometheus scrape configuration |

Run `./generate-env.sh` to make `.env` with random secrets (the server refuses every value in the example file). Then `./build-local.sh` builds the scoring engine and both images from this checkout and starts the stack. The engine is built inside the image for its architecture, so `build-engine-wheel.sh` is only needed to test with a prebuilt wheel in `server/wheels/`. `pin-release.sh` is run by a release: it writes the image digests into `docker-compose.yml` and the checksums into `install.sh`. `backup.sh` and `restore.sh` are described in docs/self-hosting.md.

The API and the broker's plain port are published on this machine only (`API_BIND`, `MQTT_PLAIN_BIND`). Put a reverse proxy with TLS in front of the API. The server and worker sign in to Postgres as the limited role `melophos_app` (from `db/roles.sql`) and migrations run as the owner through `MIGRATIONS_DATABASE_URL`. Every image is pinned by digest.

The server applies its own database migrations when it starts, so the database container has no init script. `MQTT_ADMIN_USERNAME` and `MQTT_ADMIN_PASSWORD` create the broker's administrator on first start and the server uses them to write the access rules.

> [!CAUTION]
> `docker compose down -v` deletes the database volume. Use `stop` or plain `down` to keep practice data.
