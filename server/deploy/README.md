# Deploy

Docker Compose stack for self-hosting. Full instructions are in [self-hosting.md](https://github.com/melophos/docs/blob/main/self-hosting.md).

| Service | Image | Purpose |
| --- | --- | --- |
| `db` | `timescale/timescaledb` | Postgres with TimescaleDB |
| `redis` | `redis` | Job queue for the worker |
| `mqtt` | `eclipse-mosquitto` | Broker the hubs publish to |
| `minio` | `minio/minio` | Object storage for recordings and imports |
| `server` | built from `..` | The API |
| `worker` | built from `..` | Import jobs |
| `prometheus`, `grafana` | official images | Optional, with `--profile monitoring` |

| Folder | Contents |
| --- | --- |
| [`mosquitto/`](mosquitto/) | Broker configuration |
| [`monitoring/`](monitoring/) | Prometheus scrape configuration |

> [!CAUTION]
> `docker compose down -v` deletes the database volume. Use `stop` or plain `down` to keep practice data.
