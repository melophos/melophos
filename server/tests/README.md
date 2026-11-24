# Server tests

The tests use a real Postgres with TimescaleDB and a real Mosquitto from a throwaway compose file. Nothing is faked.

```bash
docker compose -p melophos-server -f tests/infra/compose.yml up -d --build --wait
pytest
docker compose -p melophos-server -f tests/infra/compose.yml down -v
```

The compose file uses its own project name, ports 25432 and 21883 on the loopback address and no volumes. The suite creates a database with a random name on that server and drops it at the end. It refuses a server that is not on this machine, that uses port 5432 or that `DATABASE_URL` points at and it never drops a database whose name does not start with `melophos_test_`.

| File | Covers |
| --- | --- |
| `test_safety.py` | The guards that keep the suite away from a development database |
| `test_migrations.py` | Each migration runs once and is recorded, a second run does nothing, a changed or failing one is handled |
| `test_sessions.py`, `test_persistence.py`, `test_pagination.py` | The session API, restarts, stable pages and cursors |
| `test_query_plans.py` | The list and event queries on 100 000 sessions and 1 000 000 events, with their plans |
| `test_accounts.py` | Sign-up, sign-in, revocation, hash counts, sign-in rate limits |
| `test_pairing.py` | Pairing codes, single use, expiry, guess limits, credentials stored hashed |
| `test_route_access.py` | Every registered route is classified and its label is true |
| `test_isolation.py` | Account B asking for account A's things by id |
| `test_mqtt.py`, `test_ingest.py` | Topic and payload validation, bad payloads, replays, rates |
| `test_broker.py` | The real broker's rules: a hub publishes only under its own id |
| `test_mqtt_e2e.py` | The simulator, the broker, the server and the database end to end |
| `test_webhooks.py` | Payload, signature, retries, switching off, address checks, redirects |
| `test_midi.py`, `test_midi_fuzz.py`, `fuzz_midi.py` | The MIDI reader on good and hostile files and the fuzzer |
| `test_hands.py` | The hand split on labelled files and the difficulty rating |
| `test_songs.py` | The song API and worker and correcting the hand split |
| `test_scoring.py` | Scoring off the request path: slow, failing and refused engines, retries and refusing to start with the stand-in |
| `test_limits_and_deletion.py`, `test_floods_and_broker_upgrade.py` | Parallel races, shared addresses, quotas, deletion, pairing floods, spraying, readiness, broker upgrade and counters |
| `test_instances_and_hashing.py` | Ingest instances and the lock, first sign-in under a spray, the hash gate, health checks, pairing places for known addresses |
| `test_app_role.py` | The limited role and the non-superuser owner, the upgrade of an old install and the start-up rights check, with roles of their own |
| `test_rate_windows.py` | Sliding windows: no double burst at a boundary for sign-in, pairing guesses, uploads and sign-up |
| `test_stats.py`, `test_health.py`, `test_integrations.py`, `test_profiles.py` | Summaries, health and metrics, integrations and instrument profiles |
