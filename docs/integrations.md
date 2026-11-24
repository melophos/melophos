# Integrations

Every integration is optional and stays off until its settings are filled in `server/deploy/.env`.

## Spotify

Builds a learn list from what the user actually listens to.

- **Scopes requested:** `user-top-read` and `user-read-recently-played`. Nothing else.
- **What is used:** track titles, artists and play counts. Audio never comes from Spotify.
- **Setup:** create an app in the Spotify developer dashboard, set its redirect URI to `SPOTIFY_REDIRECT_URI` and fill `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.

> [!NOTE]
> Every self-hosted server uses its own Spotify app, so there is no shared client id to rate-limit or revoke. Spotify limits apps in development mode to a small number of users, which suits a personal or family server.

## WLED

Makes room lights react to playing. Each note sets a colour by pitch class, so the same note is always the same colour, with brightness from velocity. Set `WLED_HOST` to the controller's address. A lower-latency realtime stream over DDP is planned.

## Home Assistant

Hubs publish to MQTT, which Home Assistant can subscribe to directly. Automations can react to a session starting or finishing, for example dimming the room lights when practice begins. Set `HOME_ASSISTANT_URL` and a long-lived access token in `HOME_ASSISTANT_TOKEN` for actions the server triggers.

## Webhooks

Each account can register webhook endpoints in the Studio or through `POST /api/v1/webhooks`. When `SESSION_WEBHOOK_URL` and `SESSION_WEBHOOK_SECRET` are set the server also posts every finished session on the server to that one address. Each delivery is JSON:

```json
{
  "event": "session.finished",
  "session_id": "4f6c...",
  "device_id": "hub-01",
  "profile_id": "piano-88",
  "started_at": "2026-09-30T18:00:00+00:00",
  "summary": {
    "duration_ms": 1800000,
    "notes_played": 2140,
    "unique_notes": 41,
    "most_played_note": 60,
    "mean_velocity": 72.4,
    "notes_per_minute": 71.3
  }
}
```

Each delivery is signed with a secret that belongs to the endpoint, so a receiver can tell it came from the server and was not changed or replayed. The headers, the rule for checking a signature and a worked example are in the [server README](https://github.com/melophos/server#webhooks). A failed delivery is tried up to 6 times with growing waits and an endpoint that keeps failing is switched off and says so. Addresses must be `https` and public: the server refuses any that point at the local network.
This is the simplest way to show practice on an external dashboard, a personal site or a chat channel.
