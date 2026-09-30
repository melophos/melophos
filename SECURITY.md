# Security Policy

## Scope

MELOPHOS runs on a user's own network: a hub on Wi-Fi, a self-hosted server and a browser app. In scope:

- Authentication or authorisation flaws in the server API, including one user reading or writing another user's sessions, recordings or songs
- A hub accepting commands or firmware updates from an unauthenticated source on the local network or over Bluetooth
- Injection flaws in the server (SQL, command or template injection), including through imported files such as MIDI, audio or video
- Secrets exposed by default configuration, logs or the Docker Compose stack
- Cross-site scripting or unsafe message handling in the Studio app, including WebMIDI and Web Bluetooth input

## Out of scope

- Attacks that need physical access to the hub or the instrument
- Denial of service against a server deliberately exposed to the internet without a reverse proxy or rate limiting
- Vulnerabilities in third-party dependencies with no demonstrated impact on MELOPHOS (report those upstream)

## Supported versions

Only the latest commit on `main` receives security fixes while MELOPHOS is in early development.

## Reporting a vulnerability

> [!IMPORTANT]
> Report privately, never in a public issue. Use [GitHub private vulnerability reporting](https://github.com/melophos/melophos/security/advisories/new) or email contact@isaacadjei.me with details and reproduction steps. Expect an acknowledgement within a few days.
