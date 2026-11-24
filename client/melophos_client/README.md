# melophos_client package

| Module | Purpose |
| --- | --- |
| `api.py` | `Client`, a thin wrapper over the server's HTTP API with account and device credentials. `sign_up` also signs in, because sign-up answers the same for a taken address |
| `credentials.py` | The simulator's saved identity, written owner-only |
| `mqtt.py` | Publishes a session over MQTT the way a hub does |
| `simulator.py` | `melophos-sim`: pairs, then builds a practice session from a profile and sends or prints it |
