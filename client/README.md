# MELOPHOS client

A Python client for the MELOPHOS server and `melophos-sim`, a hub simulator for building and testing without hardware.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Install

```bash
pip install -e .
```

## Simulator

Plays a C major scale up and down twice with human-like timing and velocity, then sends it to the server as a practice session:

```bash
melophos-sim --profile piano-88.json --server http://localhost:8000
melophos-sim --profile piano-88.json --dry-run        # print the session instead of sending it
melophos-sim --profile piano-88.json --seed 42        # the same session every run
```

Profiles come from [melophos/profiles](https://github.com/melophos/profiles).

## Client

```python
from melophos_client import Client

client = Client("http://localhost:8000")
print(client.health())
for session in client.sessions(device_id="sim-hub"):
    print(session["started_at"], session["summary"]["notes_played"])
client.close()
```

## Checks

```bash
pip install -e ".[dev]"
ruff check . && ruff format --check . && mypy && pytest
```

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
