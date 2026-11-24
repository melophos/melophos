# MELOPHOS server

The self-hostable MELOPHOS backend: accounts, hub pairing, practice sessions, note events, the song library, webhooks and the Docker Compose stack that runs it all.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Run the whole stack

```bash
cd deploy
./generate-env.sh        # makes .env with random secrets
./build-local.sh         # builds the engine and both images here, then starts the stack
```

A release uses published images pinned by digest instead, installed with `deploy/install.sh`: see [self-hosting](../docs/self-hosting.md). The compose file in the repository is a template until a release fills in the digests, so plain `docker compose up` stops with a message that says so.

The API is on `http://localhost:8000` with interactive documentation at `/docs`. The server applies and records its database migrations when it starts, so there is nothing to run by hand.

## Develop the API alone

The tests need a real Postgres with TimescaleDB and a real Mosquitto. Both come from one throwaway compose file with its own project name and ports, never the development stack.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
docker compose -p melophos-server -f tests/infra/compose.yml up -d --build --wait
```

## Checks

```bash
ruff check .
ruff format --check .
mypy
pytest
docker compose -p melophos-server -f tests/infra/compose.yml down -v
```

`python -m tests.fuzz_midi 120` fuzzes the MIDI reader for two minutes. See [tests/](tests/) for what each file proves.

## Who can call what

Every route is one of three kinds and a test walks the registered routes to prove each carries its label and really checks it. A route added without one fails the build.

| Kind | Credential | Header |
| --- | --- | --- |
| `public` | None | |
| `device` | A paired hub's secret | `Authorization: Device <device_id>:<secret>` |
| `account` | A sign-in token | `Authorization: Bearer <token>` |

An account route answers 404 (never 403) for something that belongs to another account, the same answer as for something that does not exist.

## API

Lists return `{"items": [...], "next_cursor": "..."}`. Pass `next_cursor` back as `cursor`. The order is fixed (newest first with the id as tie-break), a page holds at most 200 items and a bad cursor is a 400. Every body is capped at 8 MiB and answers 413 beyond that. Errors are `{"detail": "..."}` with words a person can act on.

### Health

| Route | Auth | Answers |
| --- | --- | --- |
| `GET /health` | public | 200 `{status, version, scorer}`. `scorer` is `engine` (the Rust crate) or `stand-in` |
| `GET /ready` | public | 200 when the database answers, otherwise 503 |
| `GET /metrics/` | off (404) until `METRICS_TOKEN` is set, then bearer token | Prometheus text. 401 without the token |

### Accounts

| Route | Auth | Limits | Answers |
| --- | --- | --- | --- |
| `POST /api/v1/auth/signup` | public | 10 per address in any hour. Password 10 to 128 characters. `ALLOW_SIGNUP=false` closes it | 202 `{status, message}`, the same whether or not the address already has an account and no token. Then call sign-in. 422 bad input. 403 closed. 429 |
| `POST /api/v1/auth/signin` | public | 5 wrong passwords per account and address in any 15 minutes. An address may try 20 different accounts in 15 minutes unless it has signed in to that account before. Past that a further account is not refused outright, because the right password must get in. It is slowed to about one password check a second for that address and the rest get 429 with `Retry-After`. At most 4 password hashes run at once, the rest get 503. A right password for an account the address already knows is never refused because of failures elsewhere | 200 `{token, expires_at, user}`. 401 `email or password is wrong` (the same for an unknown address). 429 with `Retry-After` |
| `GET /api/v1/auth/me` | account | | 200 `{id, email, display_name, events_used, events_limit, storage_full}`. At the limit new sessions are refused (413) or skipped (MQTT) until some are deleted |
| `POST /api/v1/auth/signout` | account | | 204. The token stops working |
| `GET /api/v1/auth/sessions` | account | | 200 the account's live sign-ins, `current` marks this one |
| `DELETE /api/v1/auth/sessions/{id}` | account | | 204. 404 if it is not yours |
| `POST /api/v1/auth/password` | account | 5 wrong current passwords in any 15 minutes | 204. Every other sign-in ends and the account's webhook endpoints are switched off until confirmed. 401 wrong current password. 422 |
| `POST /api/v1/auth/signout-everywhere` | account | | 204. Every sign-in ends including this one and webhook endpoints are switched off until confirmed |
| `DELETE /api/v1/auth/account` | account | 5 wrong passwords in any 15 minutes | Body `{"password"}`. 204 and the account with its devices, sessions, note events, songs, endpoints and sign-ins is deleted for good. 401. 429 |

A sign-in token lasts 30 days. Only its SHA-256 is stored.

Sign-up answers the same for an address that is taken and one that is not and sets no password on an existing account. This server sends no email, so there is no honest way to tell an existing owner or to confirm a new one and any difference in the answer would reveal who has an account. Sign-in and the device and pairing routes answer the same for a wrong secret and an unknown id too. Time does not tell the cases apart either: a sign-up runs one argon2 hash and one insert whichever way it goes and a sign-in runs one hash for a real or an unknown address (tests count the hash calls). If mail is added, the existing owner will get one message at sign-up and nothing will change in the answer.

### Devices and pairing

A new hub asks for an identity, shows the code on its screen and the owner types it into the Studio.

| Route | Auth | Limits | Answers |
| --- | --- | --- | --- |
| `POST /api/v1/pairing` | public | 20 per address in any hour. 5 waiting codes per network and 1 000 in all. A waiting code is never replaced | 201 `{device_id, device_secret, code, expires_at, expires_in}`. The secret is shown once. 429 this network already has 5 waiting. 503 pairing is very busy, retry later |
| `GET /api/v1/device` | device (paired or not) | | 200 `{device_id, paired, server_time, last_boot, claimed_by, undo_until}`. `server_time` is the server's clock in whole UTC seconds since the Unix epoch, the time source a hub trusts. `server_time_synced` is true, false or null (see docs/protocol.md). The hub polls this. After the claim the first answer creates the hub's broker login and `paired: true` means it is ready |
| `DELETE /api/v1/device/claim` | device (paired) | Within 15 minutes of the claim | 204. The hub undoes a claim it did not expect and is removed. 403 after the window |
| `POST /api/v1/devices/pair` | account | 5 wrong codes per account and 20 per address, each in any 10 minutes. 20 devices per account | 200 the device. 404 wrong or expired code. 409 full. 429 |
| `GET /api/v1/devices` | account | | 200 the account's devices |
| `GET /api/v1/devices/{id}` | account | | 200. 404 |
| `POST /api/v1/devices/{id}/credential` | account | | 200 `{device_id, device_secret}` and the old secret stops working. 404 |
| `DELETE /api/v1/devices/{id}` | account | | 204. The hub is unpaired and its sessions are deleted. 404 |

### Sessions

| Route | Auth | Limits | Answers |
| --- | --- | --- | --- |
| `POST /api/v1/sessions` | device (paired) | 50 000 events. 120 sessions per hub in any hour. 5 000 000 stored note events per account. `started_at` within the last 366 days and at most a day ahead. `device_id` in the body must be the caller's own or absent | 201 the session with its summary. 403 another device. 413 the account's storage is full. 422 bad body or time or a `song_id` that is not the account's. 429 |
| `GET /api/v1/sessions` | account | `limit` 1 to 200 (50). Optional `device_id` | 200 a page of finished sessions |
| `GET /api/v1/sessions/{id}` | account | | 200. 404 |
| `DELETE /api/v1/sessions/{id}` | account | | 204 and its note events go too. 404 |
| `GET /api/v1/sessions/{id}/events` | account | `limit` 1 to 2 000 (500) | 200 a page of note events in time order. 404 |

A session a hub is still streaming over MQTT is not listed until its `session` message arrives. A session also carries `accuracy`, `mean_timing_error_ms`, `final_speed_ppm`, `late`, `unsure`, `hands`, `played_expected`, `played_accuracy` and `score_state`. When it names a song it is first `pending`, then `scored` once the worker has the engine's answer. If the engine fails or is too slow the session stays saved with the figures empty and the state moves to `failed`. A score is never filled in by guesswork. See [scoring](#scoring).

### Songs

| Route | Auth | Limits | Answers |
| --- | --- | --- | --- |
| `POST /api/v1/songs?title=&artist=` | account | Body is the MIDI file, `Content-Type: audio/midi`, at most 1 MiB. Title 1 to 120 printable characters. 20 uploads in any hour. 200 songs | 202 the song, `import_state: queued`. 413. 415. 422. 429. 409 library full |
| `GET /api/v1/songs` | account | `limit` 1 to 200 (50) | 200 a page. Each song has `title`, `length_ms`, `note_count`, `difficulty`, `import_state` and `hands_method` |
| `GET /api/v1/songs/{id}` | account | | 200. 404 |
| `GET /api/v1/songs/{id}/notes` | account | `limit` 1 to 2 000 (500), `after` | 200 `{items, next_after}` with each note's `idx`, `hand` and timing. 404 |
| `PUT /api/v1/songs/{id}/hands` | account | 1 to 50 000 changes | Body `{"changes": [{"idx": 12, "hand": "left"}]}`. Only the notes named change. 200 the song with `hands_edited: true`. 404. 409 not imported yet. 422 a note number outside the song |
| `POST /api/v1/songs/{id}/hands/reset` | account | | 200 the song with the importer's split back. 404 |
| `GET /api/v1/songs/{id}/file` | account | | 200 the original file as an attachment. 404 |
| `DELETE /api/v1/songs/{id}` | account | | 204. 404 |

### Webhooks

| Route | Auth | Limits | Answers |
| --- | --- | --- | --- |
| `POST /api/v1/webhooks` | account | Body `{"url", "password"}`: the password is checked again so a stolen token cannot add one. 5 endpoints. 10 creations in any hour | 201 the endpoint and its `secret` (once). 401 wrong password. 422 an address the server will not send to. 409. 429 |
| `GET /api/v1/webhooks` | account | | 200 the account's endpoints |
| `GET /api/v1/webhooks/{id}` | account | | 200 with `enabled`, `consecutive_failures` and `disabled_reason`. 404 |
| `POST /api/v1/webhooks/{id}/enable` | account | Body `{"password"}` | 200. The address is checked again. 401. 404 |
| `GET /api/v1/webhooks/{id}/deliveries` | account | `limit` 1 to 50 (20) | 200 the latest deliveries with their state and attempts. 404 |
| `DELETE /api/v1/webhooks/{id}` | account | | 204. 404 |

### Integrations

| Route | Auth | Answers |
| --- | --- | --- |
| `GET /api/v1/integrations/spotify/authorise` | account | 200 `{url}`. 503 when Spotify is not configured |

## Security model

The source is public, so every defence below is written to hold when an attacker has read it. Each has a test.

| Threat | Defence |
| --- | --- |
| Stolen database | Passwords are argon2id (19 MiB, 2 passes). Sign-in tokens, device secrets and pairing codes are stored as hashes (the pairing code keyed with `SECRET_KEY`). Webhook secrets are sealed with AES-256-GCM because they must be readable to sign |
| Guessing a password | One argon2 check per sign-in whether or not the address exists. Failures are counted per address and per address and email, never per account, so a stranger cannot lock the owner out |
| Guessing a pairing code | 8 characters from 32 (about 1.1 trillion), single use, 10 minutes. A caller gets 5 wrong codes per account and 20 per address in 10 minutes, which is 2 880 a day from one address against at most 1 000 live codes |
| One account reading another's data | Every query that returns or changes data is scoped to the caller. Another account's id answers 404. Tests ask for every kind of thing by id from the other side |
| A hub writing as another hub | The broker only lets a hub publish under its own id and the server separately requires the id in the topic to be a paired device |
| Replayed hub messages | Every message carries `boot` and `seq`. Only a strictly newer pair per device and kind is accepted |
| Webhook aimed inside the network | `https` only. The host is resolved at save time and again at send time. Every address must be public and the connection goes to the address that was checked. Redirects are refused |
| Replayed webhook delivery | The signature covers a timestamp and receivers reject anything over 5 minutes old |
| Hostile MIDI | A size cap, caps on tracks and events and notes and length, a reader that cannot loop and nothing from the file used as a path. See [fuzzing](tests/) |

Residual risk on sign-in: someone who shares both your address and your account name can use up that pair's 5 guesses and lock it for up to 15 minutes. Your account still works from every other address. Nothing short of a second channel such as email can tell them from you.

Run the server behind TLS. Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of it so the rate limits see the real client address. With it at 0 the `X-Forwarded-For` header is ignored.

## Rate limits

Every limit takes its place before the work starts, under a lock, so parallel requests cannot all be judged against the same count. The caps on devices, songs and endpoints work the same way.

Every limit is a sliding window kept as one database row per counted event, so it is exact at any moment and shared by every server process. At most `L` events are accepted in any stretch of time as long as the window, never more. A fixed window would accept `L` just before a boundary and `L` more just after, which is `2L` within a few seconds. The sign-in and pairing-guess limits count only failures, so a success never uses up the allowance and a refused attempt is not recorded, so rows stay bounded and a place frees exactly when the oldest event leaves the window.

| Limit | Allowed in any window |
| --- | --- |
| Sign-up | 10 per address in 1 hour |
| Sign-in failures | 5 per account and address in 15 minutes. An IPv6 caller counts as its /64 |
| Accounts tried from one address | 20 in 15 minutes, for accounts that address has not signed in to before. After that about one password check a second for the address and the rest get 429. A right first password still gets in |
| Password hashes at once | One per processor, at least 2 and at most 8, for the whole server. One place is reserved for callers the server already knows (an address that has signed in to that account, a signed-in owner confirming a password). Others wait up to 2 seconds and then get 503. Residual: strangers from enough networks (about the number of places divided by 0.07 s a hash, so a few dozen) can keep sign-up and first sign-ins at 503. A household whose address already knows its account is still served |
| Pairing requests | 20 per address in 1 hour |
| Pairing guesses | 5 per account and 20 per address in 10 minutes. The place is taken before the code is checked and given back for a right one |
| Sessions posted | 120 per hub in 1 hour, over HTTP and MQTT together |
| Uploads | 20 per account in 1 hour |
| Webhook endpoints created | 10 per account in 1 hour |

## Scoring

Scoring uses the Rust engine through its Python module `melophos_core`, the same code as the Studio. It never runs inside a request or a database transaction. Finishing a session that names a song only marks it `pending`. The worker reads the notes, calls the engine with at most 10 seconds allowed per attempt and no database connection held and writes the result in a short transaction. A song may hold at most 50 000 notes, under the engine's limit of 100 000.

| Outcome | What happens |
| --- | --- |
| Scored | `score_state: scored` with `accuracy`, `late`, `unsure`, `mean_timing_error_ms` (empty when nothing was judged), `final_speed_ppm`, `hands`, `played_expected` and `played_accuracy` |
| Engine error or time-out | Tried again after 1 minute and after 10 minutes. After the third attempt `score_state: failed` and the figures stay empty |
| Engine refuses the input | `failed` at once, because another attempt would get the same answer |

The image installs the engine and the server refuses to start without it, so a learner is never scored by the simple stand-in matcher. `ALLOW_STAND_IN_SCORER=true` allows that for development only and `/health` reports which scorer is running. The wheel comes from CI or `deploy/build-engine-wheel.sh` and the image build stops if it is missing.

## Pairing under attack

The last 100 of the 1 000 places are kept for networks the server already knows (an address that has signed in), so a household can pair during a flood. A waiting code is never replaced, so nobody can push a real hub's code out or take it over. One network may hold 5 waiting codes and the server 1 000. Honest use is one code per household for ten minutes, so it never gets near either. A flood from one network is refused after 5. An attacker with many networks (about 200 are enough to reach 1 000) can only make new requests answer 503 for up to ten minutes at a time. They cannot touch a code that exists. The limits on guessing a code are above.

## Running more than one process

Each server process has a name (`MQTT_INSTANCE`, default `main`). Its broker login, client id and queue are built from it, the login works only under its own client id and all processes subscribe through one shared subscription, so each hub message goes to one of them. A database lock stops two processes using the same name: the second refuses to start and says so, so it cannot take the first one's broker connection over. For a maintenance run (`docker compose run server ...`) set `INGEST_ENABLED=false`. For a replica give it its own `MQTT_INSTANCE`.

Two limits to know. A shared subscription does not keep messages in order across processes, so with two processes a `session` message can be handled before its last `notes` batch and that batch is skipped and counted as `rejected`. One process keeps order, so replicas are for availability and not for speed. And a process that stops for good still has a queue at the broker that keeps getting its share for up to a week (`MQTT_SESSION_EXPIRY`), so retire a replica by setting a short expiry before it goes or by removing its login and waiting out the expiry.

## If the server is down

The server subscribes with a fixed client id (`MQTT_CLIENT_ID`) and a persistent session that lasts a week, so the broker holds hub messages while the server is away and delivers each exactly once when it returns (repeats are dropped by the `boot` and `seq` rule). The broker keeps at most 20 000 messages or 64 MiB for it. Beyond that it drops the newest messages, which the hub cannot resend because the broker already acknowledged them. That is about 80 minutes of one hub playing and less with several. Run one server process per client id.

## Health checks

The server answers `/ready` and its container is checked on that. The worker serves no port, so its container is healthy while each of its three loops (webhooks, imports and scoring) has gone round in the last minute, which it records in small files under `/tmp`. The broker is checked with a dynamic security command. The one-shot `db-roles` and `migrate` services have no check. The image itself has none, so `docker compose up --wait` waits on the right thing for each service.

## The hub's broker password

The hub does not send its device secret to the broker. Its broker password is the HMAC-SHA256 of the ASCII text `mqtt` keyed with the device secret, as 64 lower case hex characters and the server makes the same value when it creates the hub's login. A broker password seen in the clear or in the broker's files is therefore useless on the HTTP API. [docs/protocol.md](https://github.com/melophos/docs/blob/main/protocol.md) has a worked example that a test checks.

### What the score fields mean

They are the engine's figures, defined in [docs/scoring.md](https://github.com/melophos/docs/blob/main/scoring.md). `unsure` counts presses the engine could not place with confidence. They count neither for nor against the player: `accuracy` and `played_accuracy` are the engine's own figures, are never worked out again here and leave unsure presses out. `late` counts notes matched outside the timing window, early or late. A late note is not a hit, not a miss and not a wrong press, so misses are expected minus hits minus late. `accuracy` is hits over expected plus wrong. `mean_timing_error_ms` covers judged hits and late notes and leaves out the warm-up and repeats. `hands` says which hands the session played (`unknown`, `neither`, `left`, `right` or `both`), from each note's hand in the song (a correction the player made counts). `played_expected` is how many expected notes belong to the hand or hands played. `played_accuracy` is the accuracy over them and is returned only when `hands` is `left` or `right`, so a one-hand session is not marked down for the hand it did not play.

Sessions scored before the migration that added these fields were scored by an earlier engine that counted a late note as a wrong press too. Migration 010 puts every session that was `scored` back to `pending` and the worker scores them again with the current engine. Until it has, their old `accuracy` stays and `late`, `hands`, `played_expected` and `played_accuracy` are empty.

Migration 013 added `unsure` and put every session that was `scored` back to `pending`, because the engine was redesigned (a third verdict, a follower that finds the place) and its older figures mean something different. The worker scores them again with the current engine. Nothing is deployed yet, so no household has stored sessions that this affects. Until a session has been scored again its old `accuracy` stays and `unsure` is empty.

The engine can also be told which hand was practised, where the learner started and any jump they asked for. The scoring call (`CoreScorer.score` in `app/scoring.py`) takes them as `ScoreHints`. The worker passes none because no session field records them: see docs/protocol.md for what the hub and the Studio would need to send. The engine finds the place itself in the meantime.

## Song library and the hand split

> [!IMPORTANT]
> The split is a first guess. On files made for the tests where the two hands share the middle of the keyboard it averaged 78 percent right (46 to 100 percent) and those files were labelled by us and are not real music. The player must be able to correct it and `PUT /api/v1/songs/{id}/hands` stores a correction for the Studio to offer. `POST /api/v1/songs/{id}/hands/reset` goes back to the importer's answer.

An upload is stored, then the worker parses it. The split looks for the strongest evidence first:

1. Two tracks named for a hand (right, left, RH, LH, treble, bass): the names decide, even when the pitches disagree.
2. Two or more tracks: the track with the lower median pitch is the left hand.
3. One track with several channels: the same rule on channels.
4. One stream of notes: two hand positions follow the music and each note goes to the nearer one.

The `hands_method` and an explanation come back with every song. Difficulty runs from 1 to 10 as `1 + 9 * (0.45 * density + 0.20 * chords + 0.20 * leaps + 0.15 * span)`. Density is the busiest 2 seconds against 12 notes a second. Chords is the most notes one hand sounds at once, from 1 to 5. Leaps is the mean jump of a hand between notes against an octave. Span is the range past an octave against 5 octaves. Each part is capped at 1.

## Layout

| Folder | Contents |
| --- | --- |
| [`app/`](app/) | FastAPI application: routes, schemas, storage, accounts, ingestion, webhooks and the MIDI reader |
| [`worker/`](worker/) | Sends queued webhooks and imports songs |
| [`db/`](db/) | Postgres and TimescaleDB schema migrations |
| [`deploy/`](deploy/) | Docker Compose stack, MQTT broker and monitoring configuration |
| [`tests/`](tests/) | Pytest suite and the throwaway test services |

## Webhooks

Each account can register up to five HTTPS endpoints (`POST /api/v1/webhooks`). Every finished session is posted to them as JSON, as described in [integrations](https://github.com/melophos/docs/blob/main/integrations.md). The signing secret is shown once when the endpoint is created.

A delivery carries these headers.

| Header | Meaning |
| --- | --- |
| `Melophos-Event-Id` | Stable across retries. Keep the ones you have seen and skip repeats |
| `Melophos-Event` | `session.finished` |
| `Melophos-Timestamp` | Unix seconds when this attempt was signed |
| `Melophos-Signature` | `v1=` and the hex HMAC-SHA256, with the secret as the key, of the timestamp then a full stop then the raw body |
| `Melophos-Attempt` | 1 for the first try, up to 6 |

To verify a delivery, recompute the signature over the raw body bytes and compare it in constant time. Reject anything with a timestamp more than five minutes from your clock. The timestamp is part of what is signed, so a captured delivery cannot be replayed later and cannot be given a new timestamp.

<!-- webhook-example -->
```python
import hashlib
import hmac
import time

TOLERANCE_SECONDS = 300


def verify_delivery(secret: str, timestamp: str, signature: str, body: bytes) -> bool:
    """Call with the Melophos-Timestamp header, the Melophos-Signature header and the raw request body."""
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
        return False
    signed = timestamp.encode() + b"." + body
    expected = "v1=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

In a Flask view that reads `request.get_data()` for the body, the call is `verify_delivery(SECRET, request.headers["Melophos-Timestamp"], request.headers["Melophos-Signature"], request.get_data())`. Answer with any 2xx status once the delivery is stored.

Delivery never happens inside the request that finished the session. It is queued in the database and sent by the worker.

| Rule | Value |
| --- | --- |
| Attempts | 6 in total: the first at once, then after about 30 s, 2 min, 10 min, 1 h and 6 h, each wait varying by up to 20 percent |
| Time-outs | 5 s to connect, 10 s per write or read and one deadline of 15 s for the whole call whatever the receiver does. Only the first 4 KiB of the reply is read |
| Success | Any 2xx status. A 3xx is a failure, redirects are never followed |
| Switched off | After 10 failed attempts in a row. The endpoint then shows `enabled: false` and a `disabled_reason` and nothing more is queued for it. `POST /api/v1/webhooks/{id}/enable` turns it back on |
| Addresses | `https` only. The host is resolved at save time and again at send time, every address must be public and the connection goes to the address that was checked |

`SESSION_WEBHOOK_URL` and `SESSION_WEBHOOK_SECRET` set one operator endpoint that receives every session on the server, for a single-household install. The server refuses to start if the URL is set without a secret.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE). If you run a modified version as a network service, the licence requires offering your users its source.
