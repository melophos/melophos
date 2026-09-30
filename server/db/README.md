# Database

Postgres 17 with the TimescaleDB extension.

| Table | Holds |
| --- | --- |
| `users` | Accounts |
| `devices` | Hubs and simulators, with firmware and last-seen time |
| `instruments` | A user's instruments, each bound to a profile |
| `songs` | Imported songs and their import state |
| `practice_sessions` | One row per session with its summary figures |
| `note_events` | Every note of every session, a TimescaleDB hypertable |
| `recordings` | Performances saved as MIDI in object storage |
| `integration_accounts` | Tokens for linked services such as Spotify |

## Migrations

Files in [`migrations/`](migrations/) run in name order. On a fresh database the Compose stack applies them automatically through the Postgres entrypoint.

> [!IMPORTANT]
> Never edit a migration that has shipped. Add a new numbered file instead, so every existing install upgrades the same way.
