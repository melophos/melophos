# Worker

Runs slow work away from the request path. It reads its queues from the database, so it needs no other service.

| Job | What it does |
| --- | --- |
| Webhook delivery | Sends queued session webhooks with back-off, see the [server README](../README.md#webhooks) |
| Session scoring | Scores sessions that name a song with the engine, under a time limit, retrying twice before it gives up |
| MIDI import | Parses an uploaded `.mid` file, splits the hands, rates the difficulty and stores the notes |
| Tidying | Removes unclaimed pairings and old rate limit counters and fails an import that has run for over 10 minutes |

| Import | Input | Method |
| --- | --- | --- |
| MIDI | `.mid`, `.midi` | Parsed directly, in this release |
| Audio | `.wav`, `.mp3`, `.flac` | Polyphonic transcription, not built yet |
| Video | `.mp4`, `.mkv`, `.webm` | Computer vision on falling-note tutorials, not built yet |

Run it with `python -m worker.main`. It stops cleanly on SIGTERM. Each other importer lands as its own milestone in the [roadmap](https://github.com/melophos/docs/blob/main/roadmap.md).
