# MELOPHOS client

A Python client for the MELOPHOS server and `melophos-sim`, a hub simulator for building and testing without hardware.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Install

```bash
pip install -e .
```

## Simulator

Plays a C major scale up and down twice with human-like timing and velocity. A hub has an identity, so pair the simulator once first.

```bash
melophos-sim --pair --server http://localhost:8000
```

It prints a pairing code. Type the code into the Studio signed in to your account. The simulator then saves its credential to `~/.melophos-sim.json` (owner-only) and reuses it. Then play a session over HTTP or over MQTT:

```bash
melophos-sim --profile piano-88.json --server http://localhost:8000
melophos-sim --profile piano-88.json --mqtt localhost:1883     # status, notes every 250 ms, then the session
melophos-sim --profile piano-88.json --dry-run                 # print the session instead of sending it
melophos-sim --profile piano-88.json --seed 42                 # the same session every run
```

In MQTT mode each run counts as a new power-up, so its message counters start again and the server accepts it. Profiles come from [melophos/profiles](https://github.com/melophos/profiles).

## Client

```python
from melophos_client import Client

client = Client("http://localhost:8000")
client.sign_in("me@example.com", "my long password")
for session in client.iter_sessions():
    print(session["started_at"], session["summary"]["notes_played"])
client.close()
```

A hub's calls use `Client(url, device_id=..., device_secret=...)` instead. `start_pairing()` gets an identity and a code, `claim(code)` is the owner's side and `post_session()` stores a session.

## Checks

```bash
pip install -e ".[dev]"
ruff check . && ruff format --check . && mypy && pytest
```

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
