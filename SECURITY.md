# Security Policy

## Scope

MELOPHOS runs on a user's own network: a hub on Wi-Fi, a self-hosted server and a browser app. In scope:

- Authentication or authorisation flaws in the server API, including one user reading or writing another user's sessions, recordings or songs
- A hub accepting commands or firmware updates from an unauthenticated source on the local network or over Bluetooth
- Injection flaws in the server (SQL, command or template injection), including through imported files such as MIDI, audio or video
- Secrets exposed by default configuration, logs or the Docker Compose stack
- Cross-site scripting or unsafe message handling in the Studio app, including WebMIDI and Web Bluetooth input
- The hub's update signature check and the images and install files that ship with a release
- The public website in `site/`
- The Discord tooling in `discord/`: the GitHub relay and the slash command worker

## Out of scope

- Attacks that need physical access to the hub or the instrument
- Denial of service against a server deliberately exposed to the internet without a reverse proxy or rate limiting
- Vulnerabilities in third-party dependencies with no demonstrated impact on MELOPHOS (report those upstream)

## Supported versions

Only the latest commit on `main` receives security fixes while MELOPHOS is in early development.

## Reporting a vulnerability

> [!IMPORTANT]
> Report privately, never in a public issue or on the Discord server.

- Use [GitHub private vulnerability reporting](https://github.com/melophos/melophos/security/advisories/new).
- Or email [security@melophos.com](mailto:security@melophos.com) with a description and the steps to reproduce and the likely impact.

The Discord server is not a reporting route. Not even a direct message or a `/ticket` is read as a security report. We remove posts that describe a vulnerability.

We reply within 72 hours.
