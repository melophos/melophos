# Self-hosting

The whole server stack runs with Docker Compose on any machine with Docker: a home server, a Raspberry Pi 5, a NAS or a small VPS.

## Requirements

- Docker Engine 24 or later with the Compose plugin
- 2 GB of RAM for the core stack, 4 GB with audio transcription
- A reverse proxy with TLS in front of the API (Caddy or Traefik) and port 8883 (MQTT over TLS) reachable from the hubs. The API on port 8000 and the broker's plain port 1883 are published on this machine only

## Install

> [!NOTE]
> The images, the signing and the install script are built and tested but nothing has been published yet. The release workflow cannot run until the repository is pushed, so until the first version tag exists use "Building the images yourself" below.

There are two layouts and this guide names both. **Installed from a release** puts everything in one folder (`~/melophos` unless you choose another) and you run `docker compose --env-file .env ...` inside it. **Built from a checkout** uses `server/deploy/` in the repository and `make up`, `make down` and `server/deploy/build-local.sh`.

### From a release (one command)

Download `install.sh` from the release page of the version you want. Check it before you run it, with one of these. The first needs the GitHub tool (`gh`).

```bash
gh attestation verify install.sh --repo melophos/melophos --signer-workflow melophos/melophos/.github/workflows/publish-images.yml --source-ref refs/tags/v1.2.3
```

The second needs `cosign` and the files `SHA256SUMS` and `SHA256SUMS.sigstore.json` from the same release page:

```bash
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity https://github.com/melophos/melophos/.github/workflows/publish-images.yml@refs/tags/v1.2.3 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

On macOS use `shasum -a 256 --check --ignore-missing SHA256SUMS`. Then run it:

```bash
sh install.sh --version v1.2.3
```

What each check does and does not protect against:

| Check | Protects against | Does not protect against |
| --- | --- | --- |
| `gh attestation verify` or `cosign verify-blob` on the release files | A file on the release page that was swapped or edited after the release workflow built it, including `install.sh` itself | A release the maintainers made on purpose with bad code. It proves who built the files and from which tag, not that the code is good |
| The checksums inside `install.sh` | A download that was corrupted or changed on the way. Also a wrong `--base-url` | A changed `install.sh` (the checksums live inside it), so check `install.sh` first as above |
| The image signature check in `install.sh` | An image in the registry that this release's workflow run did not sign, a different release or a branch build | The code in a signed image being wrong. Only the two MELOPHOS images are checked. The database, Prometheus and Grafana images are pinned by digest but come from other publishers and are not signature-checked here |
| Digests in the compose file | A tag that moves after the release | A digest that was wrong when the release was made |

`install.sh` checks that Docker and Compose are present and needs `curl`, `openssl` and `cosign` 3 or later (the release is signed in the format cosign 3 writes). It downloads every file into a work folder and checks each against the checksums written into it. It makes the new `.env` there (random secrets for a new install and only the missing keys for an update), verifies the signature of each MELOPHOS image against this exact release (the workflow `publish-images.yml` at the tag `v1.2.3` and the GitHub issuer, nothing wider) and only then moves the files into place and starts the stack. A failure before that point leaves your folder as it was. A folder the run created is removed. Each file is replaced with one rename and the compose file is replaced last. It runs `generate-env.sh`, which it has checked against its checksum. It runs nothing else it downloaded. It refuses to run as root unless you pass `--allow-root`, refuses a `.env` that is a link, never replaces a value in your `.env` and never touches your data. It does not change the mode of a folder that already exists but tells you if it is open to other users. It makes `mosquitto/certs` and `monitoring` so Docker does not create them as root.

Running it again is safe. An update replaces the compose file and keeps the old one beside it as `docker-compose.yml.previous`. A run that fails before the move never touches that file. Keys that a new version added to `.env` are appended with generated values and listed when it finishes.

Anyone in the `docker` group can become root on the machine, so the install folder and the Docker group are as trusted as the root account.

When it finishes it prints what to do next: create the first account, pair a hub, turn sign-up off (`ALLOW_SIGNUP=false`), back up and update. The images are public, so a household pulls them without signing in once a maintainer has made the packages public (see "For maintainers" below).

### Building the images yourself

```bash
git clone https://github.com/melophos/melophos.git
cd melophos
server/deploy/generate-env.sh
make up
```

`generate-env.sh` writes `server/deploy/.env` with random secrets and refuses to overwrite one or to write through a link. The server will not start with any value from `.env.example`, a short secret or a guessable one. `make up` runs `server/deploy/build-local.sh`, which builds the scoring engine and both images on this machine for its own architecture and starts the stack. The compose file in the repository is a template: until a release fills in the image digests, `docker compose config` stops with "no image digest yet" and the way to build locally. Any other Compose command goes through the same script, for example `server/deploy/build-local.sh logs -f server`.

The images install their Python packages from hashed lock files (`server/requirements*.lock`, made by `server/lock-requirements.sh`) with `--require-hashes`, so nothing is resolved on build day. What is not pinned: the Debian packages that the pinned Python packages depend on inside the build stage (only the base image's digest holds them). The Python and `pip` of the base images (held by their digests). The build stops loudly when Debian replaces a pinned package. The pin is then moved by hand.

| Service | Address |
| --- | --- |
| API and its documentation | `http://127.0.0.1:8000/docs` on the machine itself and through your reverse proxy for everyone else |
| MQTT broker for hubs | `<host>:8883` with TLS (see below). Plain `127.0.0.1:1883` is for the server and development |

To add Prometheus and Grafana pass `--profile monitoring up -d` to the same script. In an install folder pass it to `docker compose` instead. The monitoring files have not been tested yet. The installer writes `monitoring/metrics_token` from `METRICS_TOKEN` readable by every user of the machine, because Prometheus runs as an unprivileged user inside its container. The token only opens the metrics page.

> [!CAUTION]
> Stop the stack with `make down` (checkout) or `docker compose stop` (install folder), which keep data. Never run `docker compose down -v`: the `-v` flag deletes the database volume and every practice session with it.

## Raspberry Pi 5

Tested on arm64 under Docker Desktop, not yet on a Raspberry Pi 5. The images are built for amd64 and arm64. The arm64 build was run here as a whole stack of database, broker, server and worker. Measured on a mostly idle stack with one account:

| Service | Memory | CPU at rest |
| --- | --- | --- |
| database (TimescaleDB) | 139 MiB | 0.0% |
| server | 75 MiB | 0.1% |
| worker | 40 MiB | 0.0% |
| broker | 3 MiB | 0.0% |
| Total | about 257 MiB | under 1% of one core |

The images are 316 MB (server) and 45 MB (broker). Busy figures will be higher: the database grows its caches with use and every scoring and every sign-in takes memory and CPU for a moment. Adding the monitoring profile costs several hundred MiB more and was not measured. Run a 64-bit operating system (Raspberry Pi OS Lite 64-bit) and keep the data on an SSD, not a memory card.

What a Pi 5 would have left, assuming about 0.5 GB for the operating system and Docker and allowing the stack twice its idle figure: a 4 GB model has roughly 3 GB free after the stack and an 8 GB model roughly 7 GB. Both are comfortable for a household. This is an estimate from the Mac figures and not a measurement.

If you have a Pi 5, please run these checks and report the numbers:

1. `uname -m` says `aarch64` and `docker version` shows Engine 24 or later with Compose.
2. `sh install.sh --version <release>` finishes without an error and all four services show `healthy` in `docker compose ps`.
3. `docker stats --no-stream` after five minutes idle: note memory and CPU per service.
4. Sign up, sign in, pair a hub and play one piece. Note that the score appears.
5. `free -m` and `vcgencmd get_throttled` (should print `throttled=0x0`) while playing.
6. Run `backup.sh`, then `restore.sh` on the file it wrote. Then sign in again.

## Updating and going back

Take a backup first (below). Then run the `install.sh` of the new version with the same `--dir`, after checking it as above. It verifies everything before it changes anything, keeps your `.env` (adding only keys that the new version needs) and your data, saves the old compose file as `docker-compose.yml.previous` and starts the new images. The `migrate` service runs once before the server and the worker start and applies only the new migrations.

A failed migration shows as `migrate` exiting with an error: `docker compose ps -a` lists it as `Exited (1)` and `docker compose logs migrate` names the migration and the reason. The server and the worker do not start in that case, so nothing runs on a half-changed database. Each migration runs in one transaction, so a failed one leaves the database as it was before it.

To go back, copy `docker-compose.yml.previous` over `docker-compose.yml`, write the old version into `VERSION` and run `docker compose --env-file .env up -d`. An install run that fails before the move never changes `docker-compose.yml.previous`, so it still holds the compose file of the version that last started. A version that applied a migration cannot always be undone by the older images. If the old version refuses to start restore the backup you took before the update (below).

## Backup and restore

**A backup holds every secret of the install.** The copy of `.env` has the database passwords, `SECRET_KEY` and the broker password. The dump has every account's data. Anyone who can read the files can read all of it. Without encryption they are plain files readable by you only. Do not put plain backups on a shared drive, in an email or in a public bucket.

```bash
./backup.sh
```

writes the database (with its time series), the broker rules, a copy of `.env` and a file saying which version made them into `backups/`. It stops without leaving files if any part fails. The broker rules are part of it, so the stack must be running (`--allow-missing-broker` skips them on purpose). Keep `SECRET_KEY` with the data: it seals the stored webhook secrets. Without it they cannot be read.

To encrypt with [age](https://github.com/FiloSottile/age), make a key once with `age-keygen -o key.txt` and keep `key.txt` somewhere other than the backups (a password manager or a drive that is not the server). Then:

```bash
./backup.sh --encrypt age1...yourpublickey
./restore.sh backups/melophos-<stamp> --identity key.txt
```

The files get a `.age` ending and nothing plain is written to disk. A lost key means the encrypted backup cannot be read by anyone, so a copy of the key matters as much as the backup.

```bash
./restore.sh backups/melophos-<stamp>
```

checks the backup first. It reads the dump before it changes anything, refuses a backup from a newer version than the install (an older one is fine, the migrations bring it forward) and refuses one that does not say which version made it. It asks you to type `yes`. Then it takes a safety backup of the current data (`backups/pre-restore-...`, encrypted for the same key when the backup you are restoring is encrypted), restores the dump into a new database and switches to it only when every step worked. Any failure stops it with a plain message and leaves the running database as it was. The database it replaced is kept under another name (`melophos_replaced_<time>`) and the end of the run prints the command that removes it once you are sure. `SECRET_KEY` is taken from the `.env` saved with the backup. Your previous `.env` is kept as `.env.before-restore`. The other values stay as they are in this install, because the database passwords belong to this install's database volume. Neither script runs `.env` as shell code: values are read as text.

This was tested here with real databases: a restore round trip including a time series table. A failure was forced at each step of the restore (nothing changed each time). The broker rules were backed up and restored by hand once with a running broker. Nothing has run on a Raspberry Pi 5.

## Keep the server's clock right

The server's clock decides which session dates are accepted. Every hub takes its time from the server (`server_time` in the answer of `GET /api/v1/device`), because a hub cannot tell a forged network time answer from a real one. So the clock must be right. The server tells hubs whether it knows that it is (`server_time_synced`).

**What a Raspberry Pi does.** It has no clock battery. At boot its system restores the time it was switched off at. After a power cut the server therefore starts at once with a clock that is behind by the length of the cut, until the network has set it, which can take a minute or longer. The server asks the kernel whether the clock has been synchronised (the Linux `adjtimex` call, with no extra package). While it has not been:

- the server still starts and serves, so a household does not lose its server after every power cut
- it logs this plainly at start and when the state changes
- it tells hubs `server_time_synced: false`. A hub then holds and does not correct its clock from the server yet
- every session it receives meanwhile is marked (`clock_unsynced: true` in the session), so a date that may be wrong can be found
- it refuses nothing else it would have accepted

It also refuses to start when the clock says a time before the one its software was built, because that clock is plainly wrong. Docker restarts it until the clock is set.

Check synchronisation before pairing a hub and after a power cut:

```bash
timedatectl show -p NTPSynchronized
```

It must print `NTPSynchronized=yes`. If it says `no` wait for the network time or fix the time service (`systemd-timesyncd` on Raspberry Pi OS).

`null` means the server could not read the status on this platform (it is not 64-bit Linux or a container profile refuses the call). Hubs treat null as synchronised. The server logs one warning at start. In a container the call worked under Docker Desktop's default profile. It has not been tried on a Raspberry Pi 5. `CLOCK_SYNC` in `.env` overrides what is reported: `auto` (the default) asks the kernel, `true` always reports synchronised (use it when the kernel cannot be asked and you know the time is kept right) and `false` always holds hubs back. A server whose clock is wrong by a little while the kernel says it is synchronised is not detected, so session dates can still be a little off.

## Exposing it beyond the home network

The broker refuses anonymous connections and gives each paired hub a login that can only publish under its own id. Before exposing anything to the internet:

1. Put the API behind a reverse proxy with TLS (Caddy or Traefik) that connects to `127.0.0.1:8000` and set `TRUSTED_PROXY_HOPS` to the number of proxies and `TRUSTED_PROXY_CIDRS` to the address the proxy connects from as the server sees it (for example `172.18.0.1/32`). The server believes `X-Forwarded-For` only from that address and only for that many hops and refuses to start with hops but no address. Never publish port 8000 on a public address (`API_BIND`).
2. Set `ALLOW_SIGNUP=false` once your household has accounts.
3. Keep port 1883 closed to the internet. Hubs use TLS on 8883 or a VPN such as WireGuard or Tailscale.
4. Keep `METRICS_TOKEN` empty unless you run Prometheus: `/metrics` is off until it is set.

## The database logins

The stack uses three database logins and keeps them apart. The superuser (`POSTGRES_USER`) is seen only by the database and the one-shot `db-roles` step. That step runs on every start. It makes an owner role that is not a superuser and the limited role `melophos_app` and it gives each its rights. The owner (`POSTGRES_OWNER_PASSWORD`) owns the tables and is seen only by the one-shot `migrate` step, which applies the migrations. The server and the worker get only the limited role: it can read and write the tables and nothing else and it has no rights on the record of which migrations ran. The server refuses to start if its own database login has more rights than that.

### Upgrading an install made before these roles existed (built from a checkout)

1. Back up the database volume.
2. `git pull`.
3. In `server/deploy/.env` delete `DATABASE_URL` and `MIGRATIONS_DATABASE_URL` and add `POSTGRES_OWNER_PASSWORD` and `POSTGRES_APP_PASSWORD`, each from `openssl rand -base64 24 | tr -d '/+='`. Keep `POSTGRES_USER` and `POSTGRES_PASSWORD` as they are.
4. `make up`. The `db-roles` step moves the tables to the owner and creates the limited role, `migrate` applies anything new and only then do the server and the worker start. Check with `docker compose --env-file server/deploy/.env -f server/deploy/docker-compose.yml logs db-roles migrate`.
5. If the server will not start and says its login has more rights than it needs, it is still on the superuser: step 3 was missed.

## Several server processes

A second server process (a replica) needs its own `MQTT_INSTANCE` in its environment. A maintenance run such as `docker compose run server ...` needs `INGEST_ENABLED=false`, otherwise it refuses to start because the first process holds the name. Replicas share the hub traffic but do not keep messages in order, so they suit availability. Details are in the server README.

If every request reaches the server from the same private address (for example `172.18.0.1`) the server logs a warning after 50 requests. That means a proxy or Docker's network sits in front and all callers look like one person to the sign-in limits. Set `TRUSTED_PROXY_HOPS` and `TRUSTED_PROXY_CIDRS` as described above.

## Giving the broker a certificate (TLS)

Hubs should reach the broker over TLS on port 8883. The broker turns TLS on by itself when it finds a certificate.

1. Get a certificate for the name the hubs will use, for example `mqtt.example.org`. A public certificate authority such as Let's Encrypt works if the name is public. At home you can instead make your own authority and sign a certificate with it or use a single self-signed certificate. Whichever you pick, the name or address the hub connects to must be listed in the certificate (its subject alternative names).
2. Put the certificate and its key in `mosquitto/certs/` of your install folder (`server/deploy/mosquitto/certs/` in a checkout) as `server.crt` and `server.key`. `server.crt` must hold the whole chain, the server certificate first and then any intermediates. The key must be readable by the broker's user (id 1883), for example `chmod 644 server.key` on a machine only you use.
3. Restart the stack (`docker compose --env-file .env up -d` in the install folder or `make up` in a checkout). The broker log says it opened ports 1883 and 8883. Renew the files before the certificate runs out and restart the `mqtt` service, since the broker reads them only when it starts.
4. The plain port 1883 is published on this machine only by default (`MQTT_PLAIN_BIND=127.0.0.1`). The server and the worker use it over the private Docker network. Open only port 8883 to the hubs. Set `MQTT_PLAIN_BIND=0.0.0.0` only for development with a hub that cannot do TLS and never on a network you do not control, because the broker password and everything the hub sends travel in plain text.

What each hub needs to trust the broker:

| The certificate comes from | The hub must hold |
| --- | --- |
| A public authority | The authority's root certificate (for Let's Encrypt, ISRG Root X1) in the hub's flash. The hub does not carry every public root, only the ones its firmware lists |
| Your own authority | That authority's certificate (the public part only) in the hub's flash |
| A single self-signed certificate | That certificate itself in the hub's flash. It must be replaced on the hub whenever the certificate is renewed |

The hub also needs a clock that is roughly right, because it checks the dates in the certificate and it must connect by the name in the certificate. The hub never needs the broker's key. Its own login is the device id and a password derived from the device secret (see the protocol document). A hub that cannot verify the certificate must not connect and must not fall back to port 1883.

The same rule applies to the API on port 8000: put it behind a reverse proxy with TLS as described above and give hubs the `https://` address for pairing. The pairing answer carries the device secret, so it must never travel in plain text outside your own network.

