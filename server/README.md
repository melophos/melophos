# MELOPHOS server

The self-hostable MELOPHOS backend: practice sessions, note events, song import and integrations, plus the Docker Compose stack that runs it all.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Run the whole stack

```bash
cd deploy
cp .env.example .env        # then replace every change-me value
docker compose up -d
```

The API is on `http://localhost:8000` with interactive documentation at `/docs`.

## Develop the API alone

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

## Checks

```bash
ruff check .
ruff format --check .
mypy
pytest
```

## Layout

| Folder | Contents |
| --- | --- |
| [`app/`](app/) | FastAPI application: routes, schemas, statistics, storage and integrations |
| [`worker/`](worker/) | Background import jobs: MIDI, audio transcription and tutorial video reading |
| [`db/`](db/) | Postgres and TimescaleDB schema migrations |
| [`deploy/`](deploy/) | Docker Compose stack, MQTT broker and monitoring configuration |
| [`tests/`](tests/) | Pytest suite |

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE). If you run a modified version as a network service, the licence requires offering your users its source.
