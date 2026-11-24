# Routes

Every route is labelled `public`, `device` or `account` with `**access("...")`. The full list with limits and answers is in the [server README](../../README.md#api).

| Module | Routes |
| --- | --- |
| `health.py` | `/health` and `/ready` |
| `auth.py` | Sign up, sign in, sign out, the account's sign-ins and the password |
| `devices.py` | Pairing, the hub's own status and the account's devices |
| `sessions.py` | Storing, listing and reading sessions and their events |
| `songs.py` | Uploading, listing and reading songs, their notes and their files |
| `webhooks.py` | Webhook endpoints and their deliveries |
| `integrations.py` | `GET /api/v1/integrations/spotify/authorise` |
