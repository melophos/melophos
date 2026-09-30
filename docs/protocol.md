# Protocol

The contract between the hub, the server and the Studio. Field names are identical everywhere.

## Note event

| Field | Type | Meaning |
| --- | --- | --- |
| `t_ms` | integer | Milliseconds since the session started |
| `note` | integer 0 to 127 | MIDI note number, middle C is 60 |
| `velocity` | integer 0 to 127 | How hard the note was played. 0 means released |
| `channel` | integer 0 to 15 | MIDI channel, used to tell hands apart in guided songs |
| `source` | string | `usb_midi`, `ble_midi`, `midi_jack`, `audio` or `network` |

## MQTT topics

Hubs publish to `melophos/<device_id>/<kind>`.

| Kind | Payload | When |
| --- | --- | --- |
| `notes` | Batch of note events, JSON array | Every 250 ms while notes are being played |
| `session` | A finished practice session | When a session ends |
| `status` | Firmware version, active inputs, profile, dropped-event count | On connect and every 60 seconds |

> [!WARNING]
> Device ids arrive from the network, so the server rejects any topic whose device id contains `+` or `#` or whose kind is not listed above.

## HTTP API

The server documents itself at `/docs` (OpenAPI). The main routes:

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness and version |
| `POST /api/v1/sessions` | Store a practice session and return it with a summary |
| `GET /api/v1/sessions` | List sessions, newest first, optionally filtered by `device_id` |
| `GET /api/v1/sessions/{id}` | One session with its summary |
| `GET /api/v1/integrations/spotify/authorise` | Start linking a Spotify account |

### Session summary

| Field | Meaning |
| --- | --- |
| `duration_ms` | From the first to the last event |
| `notes_played` | Key presses, releases not counted |
| `unique_notes` | Distinct notes pressed |
| `most_played_note` | The note pressed most often |
| `mean_velocity` | Average press velocity |
| `notes_per_minute` | Presses per minute over the session |

## Versioning

The API is versioned in its path. A breaking change to the note event or a topic comes with a new major API version. Hubs report their firmware version in `status` so the server can handle both versions during a transition.
