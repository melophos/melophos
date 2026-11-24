# Database

Postgres 17 with the TimescaleDB extension.

| Table | Holds |
| --- | --- |
| `users` | Accounts, with an argon2id password hash |
| `auth_sessions` | Sign-ins as token hashes that can be revoked |
| `devices` | Hubs and simulators: owner, credential hash, firmware, last-seen time and the latest status |
| `pairing_codes` | Short-lived keyed hashes of the codes hubs show |
| `rate_events` | One row per event that counts against a sliding-window limit |
| `instruments` | A user's instruments, each bound to a profile |
| `songs`, `song_files`, `song_notes` | Imported songs, the uploaded file and the notes with their hand |
| `practice_sessions` | One row per session with its summary figures |
| `note_events` | Every note of every session, a TimescaleDB hypertable |
| `known_addresses` | Addresses an account has signed in from, so spraying cannot block people an address already knows |
| `ingest_state` | The newest message accepted from each hub, which is how replays are caught |
| `webhook_endpoints`, `webhook_deliveries` | Where sessions are posted and the queue of what is left to send |
| `recordings` | Performances saved as MIDI in object storage |
| `integration_accounts` | Tokens for linked services such as Spotify |
| `schema_migrations` | Which migrations have run, with a checksum of each |

## Migrations

Files in [`migrations/`](migrations/) run in name order. The server applies the pending ones when it starts (`python -m app.db` does the same by hand). Each runs once inside one transaction and is recorded, so a second start does nothing and a failing file leaves nothing behind. Starts are serialised with an advisory lock, so two servers starting together cannot both migrate. A file that changed after it ran is refused. A database made by the old container init script is adopted by recording 001.

> [!IMPORTANT]
> Never edit a migration that has shipped. Add a new numbered file instead, so every existing install upgrades the same way.

## Indexes behind the list routes

| Query | Index |
| --- | --- |
| Sessions of a device, newest first | `practice_sessions (device_id, started_at DESC, id DESC)` |
| Sessions of an account | `devices (owner_id)` then the index above |
| One session's events in order | `note_events (session_id, at, idx)` with a time bound so TimescaleDB skips other chunks |
| An account's songs, newest first | `songs (owner_id, created_at DESC, id DESC)` |
| Due webhook deliveries | partial index on `next_attempt_at` where `state = 'pending'` |

`tests/test_query_plans.py` loads 100 000 sessions and 1 000 000 events and checks the plans use them.
