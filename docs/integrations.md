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

When `SESSION_WEBHOOK_URL` is set, the server posts every finished session summary to it as JSON:

```json
{
  "event": "session.finished",
  "session_id": "4f6c...",
  "device_id": "hub-01",
  "profile_id": "piano-88",
  "started_at": "2026-09-30T18:00:00+00:00",
  "summary": { "duration_ms": 1800000, "notes_played": 2140, "unique_notes": 41 }
}
```

This is the simplest way to show practice on an external dashboard, a personal site or a chat channel.
