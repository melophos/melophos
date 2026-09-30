# Self-hosting

The whole server stack runs with Docker Compose on any machine with Docker: a home server, a Raspberry Pi 5, a NAS or a small VPS.

## Requirements

- Docker Engine 24 or later with the Compose plugin
- 2 GB of RAM for the core stack, 4 GB with audio transcription
- Ports 8000 (API) and 1883 (MQTT) reachable from the hubs on the local network

## Install

```bash
git clone https://github.com/melophos/melophos.git
cd melophos
cp server/deploy/.env.example server/deploy/.env
```

Edit `server/deploy/.env` and replace every `change-me` value. Then:

```bash
make up
```

| Service | Address |
| --- | --- |
| API and its documentation | `http://<host>:8000/docs` |
| MQTT broker for hubs | `<host>:1883` |
| MinIO console | `http://<host>:9001` |

To add Prometheus and Grafana:

```bash
docker compose --env-file server/deploy/.env -f server/deploy/docker-compose.yml --profile monitoring up -d
```

> [!CAUTION]
> Stop the stack with `make down`, which keeps data. Never run `docker compose down -v`: the `-v` flag deletes the database volume and every practice session with it.

## Exposing it beyond the home network

The default broker accepts anonymous connections, which is only safe on a trusted local network. Before exposing anything to the internet:

1. Put the API behind a reverse proxy with TLS (Caddy or Traefik).
2. Give Mosquitto a password file and set `allow_anonymous false`.
3. Keep port 1883 closed to the internet. Use a VPN such as WireGuard or Tailscale for hubs away from home.

## Updating

```bash
git pull
make up
```

Database migrations in `server/db/migrations` run automatically on a fresh database. Upgrades that need a migration on an existing database say so in the [changelog](../CHANGELOG.md).
