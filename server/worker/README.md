# Worker

Runs slow import jobs away from the request path. The API queues a job in Redis and the worker turns the uploaded file into a song.

| Import | Input | Method |
| --- | --- | --- |
| MIDI | `.mid`, `.midi` | Parsed directly |
| Audio | `.wav`, `.mp3`, `.flac` | Polyphonic transcription |
| Video | `.mp4`, `.mkv`, `.webm` | Computer vision on falling-note tutorials |

Run it with `python -m worker.main`. Each importer lands as its own milestone in the [roadmap](https://github.com/melophos/docs/blob/main/roadmap.md).
