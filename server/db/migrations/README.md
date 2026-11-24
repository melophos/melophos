# Migrations

| File | Change |
| --- | --- |
| `001_initial_schema.sql` | Users, devices, instruments, songs, practice sessions, note events (hypertable), recordings and integration accounts |
| `002_session_storage.sql` | Stored summaries, optional device owner, the keyset indexes and the event position |
| `003_accounts.sql` | Sign-ins, device credentials, pairing codes and rate limit counters |
| `004_mqtt_ingest.sql` | Session references, the hub status columns and the replay state |
| `005_webhooks.sql` | Webhook endpoints and the delivery queue |
| `006_song_library.sql` | Song metadata, stored files and notes with their hand |
| `008_broker_and_limits.sql` | Broker login flag, ticketed rate events and the pairing requester |
| `011_counter_protection.sql` | A floor under the stored-events counter and security-definer triggers, so only the triggers move it |
| `012_clock_unsynced.sql` | A flag on a session received while the server's clock was not synchronised |
| `013_unsure.sql` | The `unsure` count of the engine's third verdict. Puts every scored session back in the queue to be scored again |
| `010_score_hands.sql` | The engine's `late`, `hands`, `played_expected` and `played_accuracy` and puts earlier scored sessions back in the queue |
| `009_known_addresses.sql` | Known addresses, a foreign key from deliveries to sessions and the stored-events counter with its triggers |
| `007_scoring_limits_hands.sql` | Scoring state and the engine's figures, sliding-window rate events and correctable hands |

Name new files with the next three-digit number and a short description, for example `007_add_song_tags.sql`.
