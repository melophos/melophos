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
| `notes` | A batch of note events in a JSON object, see message bodies | Every 250 ms while notes are being played |
| `session` | A finished practice session | When a session ends |
| `status` | Firmware version, active inputs, profile, dropped-event count | On connect and every 60 seconds |

> [!WARNING]
> Device ids arrive from the network, so the server rejects any topic whose device id is not 3 to 64 lower case letters, digits or hyphens or whose kind is not listed above.

### Pairing a hub (HTTPS)

A new hub has no identity. Firmware does the following.

1. `POST /api/v1/pairing` with no body. The answer is 201 JSON with `device_id`, `device_secret`, `code` (for example `K7QM-2XPD`), `expires_in` (600 seconds). Write `device_id` and `device_secret` to flash at once. The secret is shown only here and cannot be fetched again.
2. Show `code` on the hub for the owner. The owner types it into the Studio, signed in to their account.
3. Poll `GET /api/v1/device` every 3 seconds with the header `Authorization: Device <device_id>:<device_secret>`. The answer is 200 `{"device_id": "...", "paired": false, "server_time": 1795366351, "server_time_synced": true}` until the owner has typed the code and then `"paired": true`. Every answer carries `server_time`: the server's clock as whole seconds since the Unix epoch in UTC (an integer). The hub reaches the server over TLS, so it takes this as its trusted time source: it corrects its own clock for stamping sessions when the two differ by more than a few minutes and distrusts network time until the two agree. `server_time_synced` says whether the server knows its own clock is right. **true**: the server's clock is synchronised, so it is the authority and the hub corrects from `server_time` as just described. **false**: the server's clock has not been synchronised since it started (for example after a power cut on a machine with no clock battery), so the hub holds: it does not correct its clock from `server_time` yet and asks again at the next poll. **null**: the server cannot tell on its platform. The hub treats it as true. Sessions the server receives while it is false are marked (`clock_unsynced` in the session) so a date that may be wrong can be found.
4. If `expires_in` seconds pass without `paired: true`, discard the stored identity and start again at step 1. A new request makes a new `device_id`. Allow at most 20 requests an hour. A 429 answer carries `Retry-After`. At most 5 codes wait at one network and a sixth request is refused with 429 (use a code or wait up to 10 minutes). A waiting code is never replaced. When 1 000 codes are waiting in all a new request gets 503 with `Retry-After`. Try again later and keep the identity you already have until its code expires.
5. The broker login is made when the hub first calls `GET /api/v1/device` after the owner has typed the code, using the secret in that call. The answer is `paired: true` only when the login is ready, so the hub must not connect to the broker before it sees that. The answer also carries `last_boot`, the highest `boot` the server accepted from this hub (null when none). If the hub's own counter is more than 1 000 above `last_boot` its messages are refused, so the hub should show that to its owner. The answer also carries `claimed_by` (the claiming account's address with most of it hidden) and `undo_until`. The hub should show `claimed_by` on its screen. If it is not the owner, the hub calls `DELETE /api/v1/device/claim` within 15 minutes, which removes the identity and its login so the hub can pair again. A hub that is factory reset loses its identity and pairs again as a new device.

A 401 on any later call means the secret was changed or the hub was removed by its owner. Show "pair again" and go back to step 1.

### MQTT sign-in

Connect to the broker over TLS on port 8883 with MQTT 5 (3.1.1 also connects) with these settings. The hub must verify the broker's certificate against the host name and a trusted authority, see the self-hosting guide and must not fall back to plain port 1883, which exists for development only. Pairing and every HTTP call must use `https://` for the same reason: the device secret is in them.

| Setting | Value |
| --- | --- |
| User name | The `device_id` |
| Password | Not the secret itself. The HMAC-SHA256 of the ASCII text `mqtt` keyed with the `device_secret`, as 64 lower case hex characters (see the example below) |
| Client id | Exactly the `device_id`. The broker refuses a login whose client id is anything else |
| Keep alive | 30 to 60 seconds |
| Publish | QoS 1 and the retain flag off |
| Subscribe | Never. The broker refuses every subscription from a hub |

The device secret stays for HTTPS calls only. A broker password seen on the wire or in the broker's files is useless on the HTTP API. The server makes the same value when it creates the hub's broker login.

<!-- example: broker-password -->
```json
{"device_secret": "mph_EXAMPLE-secret-for-the-docs-0123456789abcdefABCDEF", "broker_password": "189c20803646ddce9ef9c008449266de589380c1b0873647c9f53cf763a77cca"}
```

In Python: `hmac.new(secret.encode(), b"mqtt", hashlib.sha256).hexdigest()`. In C with mbedTLS: `mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), secret, strlen(secret), "mqtt", 4, out)` then print the 32 bytes as hex.

A refused connection (CONNACK "not authorised") means the login is wrong or removed or the hub is not claimed yet (see below). Do not retry faster than once a minute and treat it like a 401 above. With MQTT 5 a publish to a topic that is not the hub's own is answered with a failure reason code. With 3.1.1 it is dropped without a sign. Either way a successful PUBACK only means the broker took the message: the server checks the body afterwards and may skip it and it sends nothing back. Firmware therefore cannot learn that a body was rejected and must build bodies exactly as below.

### Message bodies

Each message is one JSON object in UTF-8 on its own topic, `melophos/<device_id>/<kind>`. Numbers are whole numbers (no decimal point or exponent). Every body carries these two fields.

| Field | Rule |
| --- | --- |
| `boot` | A whole number from 0 to 9 007 199 254 740 991. Keep a counter in flash. At every power-up add 1 and write it to flash before the first message is sent, so a crash cannot reuse a value. Send the same `boot` in every message until the next power-up |
| `seq` | A whole number from 0 to 9 007 199 254 740 991. Keep one counter for each kind (`notes`, `session` and `status`). Start every kind at 1 after power-up and add 1 for every new message of that kind |

The server keeps the newest `(boot, seq)` for each device and kind and accepts a message only if its `boot` is higher or its `boot` is the same and its `seq` is higher. A repeat is dropped, so resending the same message with the same `boot` and `seq` after a lost PUBACK is safe. Never reuse a `seq` for different content and never go back to an older `boot`. A `boot` more than 1 000 above the last one the server saw is refused and a new device may start at any `boot` up to 1 000 000. A new device secret clears what the server remembers, so a hub given a new secret starts again from any `boot`.

| Kind | Fields | Largest body | When |
| --- | --- | --- | --- |
| `notes` | `boot`, `seq`, `session_ref`, `started_at`, `profile_id`, `events` (1 to 1 000 note events) | 64 KiB | Every 250 ms while notes are played |
| `session` | `boot`, `seq`, `session_ref`, `started_at`, `profile_id`, optional `mode`, optional `song_id`, optional `events` (0 to 1 000) | 128 KiB | Once when a session ends |
| `status` | `boot`, `seq`, `firmware`, optional `profile_id`, `inputs`, `dropped_events` | 4 KiB | After connecting and every 60 seconds |

| Field | Type | Rule |
| --- | --- | --- |
| `boot` | integer | See above. In every message |
| `seq` | integer | See above. In every message |
| `session_ref` | string | 1 to 64 characters from letters, digits, `.`, `_` and `-`. New for every practice session and the same in every message of that session. In `notes` and `session` |
| `started_at` | string | When the session began, as ISO 8601 with a zone, for example `2026-09-30T18:00:00Z`. It must be within the last 366 days and no more than a day ahead or the message is skipped. Without a zone the message is skipped, so a hub with no clock yet must not send until it has the time. The same value in every `notes` and `session` message of a session |
| `profile_id` | string | 1 to 64 characters, the id of the instrument profile. Required in `notes` and `session`, optional in `status` |
| `mode` | string | One of `melody`, `rhythm`, `listen` or `free`. Optional, in `session` |
| `song_id` | string | A song id (UUID) from the account's library. Optional, in `session`. A song that is not the owner's skips the message |
| `events` | array of note events | Note events as in the table at the top, with `t_ms` in whole milliseconds since `started_at` from 0 to 21 600 000. `notes`: 1 to 1 000 events. `session`: 0 to 1 000 and optional |
| `firmware` | string | 1 to 32 characters. Required in `status` |
| `inputs` | array of strings | Up to 8 of `usb_midi`, `ble_midi`, `midi_jack`, `audio` and `network`. Optional, in `status` |
| `dropped_events` | integer | Events the hub dropped, 0 or more. Optional, in `status` |

Unknown extra fields are ignored. A missing required field, a wrong type or a value out of range skips the whole message.

Examples. Each is a complete body that the server accepts and a test checks every one against the server's own models.

<!-- example: notes -->
```json
{"boot": 7, "seq": 1, "session_ref": "b7-s1", "started_at": "2026-09-30T18:00:00Z", "profile_id": "piano-88", "events": [{"t_ms": 0, "note": 60, "velocity": 90, "channel": 0, "source": "usb_midi"}, {"t_ms": 240, "note": 60, "velocity": 0}]}
```

<!-- example: session -->
```json
{"boot": 7, "seq": 1, "session_ref": "b7-s1", "started_at": "2026-09-30T18:00:00Z", "profile_id": "piano-88", "mode": "melody", "song_id": "4f6c0a52-8d63-4a64-9f0e-6b0a1f3a9c21"}
```

<!-- example: session -->
```json
{"boot": 8, "seq": 1, "session_ref": "b8-s1", "started_at": "2026-10-01T09:30:00+01:00", "profile_id": "piano-61", "events": [{"t_ms": 0, "note": 64, "velocity": 70}, {"t_ms": 500, "note": 64, "velocity": 0}]}
```

<!-- example: status -->
```json
{"boot": 7, "seq": 1, "firmware": "0.1.0", "profile_id": "piano-88", "inputs": ["usb_midi", "midi_jack"], "dropped_events": 0}
```

<!-- example: status -->
```json
{"boot": 8, "seq": 1, "firmware": "0.1.0"}
```

### Repeated and old messages

With QoS 1 a message can arrive twice. The server drops any message whose `(boot, seq)` is not newer than the newest it accepted for that device and kind. It stores nothing for a repeat and answers nothing: the hub sees only the broker's normal PUBACK. A repeat is not an error. It is counted (`melophos_mqtt_messages_total{outcome="replayed"}`) and logged at info level, never as a warning and it does not stop later messages. So firmware may publish at QoS 1 and resend the identical message (same `boot`, same `seq`, same body) after a missing PUBACK without ever storing a session twice. A message with an older `seq` that arrives after a newer one of the same kind is dropped the same way, so send each kind in order.

`session_ref` ties the messages of one session together. The `notes` messages and the final `session` message add up to one session, which appears in the owner's list once the `session` message is stored. A short session may skip the `notes` messages and put up to 1 000 events in the `session` message. A session holds at most 50 000 events in all. After the `session` message further messages for that `session_ref` are skipped. The server allows 100 messages from one hub in any 10 seconds and skips the rest and a session holds at most 50 000 events and an account at most 5 000 000. The server subscribes with a fixed client id and a persistent session, so if it is down for a while the broker holds the hub's messages and delivers them when it returns. The broker keeps at most 20 000 messages or 64 MiB for the server and drops the newest beyond that. A hub that was already acknowledged cannot resend, so long server outages lose data once that is passed. A hub may start at most 120 new sessions in any hour. A message that is too large or malformed or older than the newest accepted one is skipped and counted and never stops other messages.

## HTTP API

The server documents itself at `/docs` (OpenAPI). Every route is public, device or account: a hub sends `Authorization: Device <device_id>:<secret>` and a signed-in person sends `Authorization: Bearer <token>`. The server README lists every route with its limits and answers. The main routes:

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness and version |
| `POST /api/v1/auth/signup`, `POST /api/v1/auth/signin` | Create an account and sign in |
| `POST /api/v1/pairing` | A new hub asks for an identity and a pairing code to show |
| `POST /api/v1/devices/pair` | The owner types the code to claim the hub |
| `POST /api/v1/sessions` | A paired hub stores a practice session and gets it back with a summary |
| `GET /api/v1/sessions` | List the account's sessions, newest first, in pages of at most 200 |
| `GET /api/v1/sessions/{id}` | One session with its summary |
| `GET /api/v1/sessions/{id}/events` | The session's note events in pages |
| `POST /api/v1/songs`, `GET /api/v1/songs` | Upload a MIDI file and list the library |
| `PUT /api/v1/songs/{id}/hands` | Store a corrected hand split. The importer's split is a first guess |
| `POST /api/v1/webhooks` | Register an address that receives each finished session |
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

### Session score

A session that names a song is scored after it finishes, so its score fields are empty and `score_state` is `pending` at first. When it is `scored` the session carries:

| Field | Meaning |
| --- | --- |
| `accuracy` | Hits over the expected notes plus the wrong presses |
| `late` | Notes matched outside the timing window, early or late. A late note is not a hit, not a miss and not a wrong press |
| `unsure` | Presses the engine could not place with confidence. They count neither for nor against the player, so show them neutrally. `accuracy` and `played_accuracy` never include them |
| `mean_timing_error_ms` | Mean timing error over judged hits and late notes, leaving out the warm-up and repeats. Null when nothing was judged |
| `final_speed_ppm` | The tempo reached, where 1 000 000 is the written speed |
| `hands` | Which hands were played: `unknown`, `neither`, `left`, `right` or `both` |
| `played_expected` | How many expected notes belong to the hand or hands played |
| `played_accuracy` | Accuracy over those notes. Set only when `hands` is `left` or `right` |

If scoring fails the session keeps empty figures and `score_state` is `failed`. A score is never made up.

#### What the engine could be told and the protocol does not carry

The engine takes three things the caller may know: the hand the learner practised (`practise`: left, right or both), the written time the learner started from (`start_ms`) and any jump they asked for (`jumps`: the press index and the written time to go on from). No message or session field carries any of them today, so the server passes none and the engine finds them itself: the start and a jump show as unsure presses until it has found the place. A slip onto the other hand's key may be called wrong instead of unsure. To gain the accuracy, a later version of the `session` message would need an optional `practise` (one of `left`, `right`, `both`), an optional `start_ms` (whole milliseconds into the song) and an optional `jumps` list of `[press_index, ms]` pairs, sent by the hub or the Studio from the learner's choice at the keyboard or on screen. Nothing was added here: a field is a protocol change for the firmware to agree.

## Versioning

The API is versioned in its path. A breaking change to the note event or a topic comes with a new major API version. Hubs report their firmware version in `status` so the server can handle both versions during a transition.
