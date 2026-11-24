#!/bin/sh
# Installs or updates MELOPHOS from a release. It is short on purpose: read it before you run it and check it first
# with the command in docs/self-hosting.md (the release attests this file).
#
#   sh install.sh --version v1.2.3                 installs into ~/melophos
#   sh install.sh --version v1.2.3 --dir /srv/m    installs somewhere else
#
# What it does, in this order and it stops at the first thing that is wrong:
#   1. checks Docker, Compose and the tools it needs
#   2. downloads every file into a work folder and checks each against the checksum written into this script
#   3. makes the work copy of .env (new secrets for a new install, only the missing keys added for an update)
#   4. verifies the signature of each MELOPHOS image against this exact release
#   5. only then moves the files into place and starts the stack
# Nothing in your folder changes before step 5, so a failed check leaves a working install as it was. It never
# replaces a value in your .env and never touches your data. The compose file it replaces is kept beside it as
# docker-compose.yml.previous. It runs generate-env.sh, which it has checked against its checksum first and nothing
# else it downloaded.
set -eu

RELEASE_VERSION="__FILLED_BY_RELEASE__"
REGISTRY="__FILLED_BY_RELEASE__"
# BEGIN FILES: checksum, name in the release, place in the folder, mode
FILES="
__FILLED_BY_RELEASE__
"
# END FILES

REPO_WORKFLOW="https://github.com/melophos/melophos/.github/workflows/publish-images.yml"
ISSUER="https://token.actions.githubusercontent.com"

version="" dir="${HOME:-.}/melophos" base="" key="" skip_verify=0 allow_root=0 start=1
while [ "$#" -gt 0 ]; do
    case "$1" in
        --version) version="${2:-}"; shift 2 ;;
        --dir) dir="${2:-}"; shift 2 ;;
        --base-url) base="${2:-}"; shift 2 ;;
        --cosign-key) key="${2:-}"; shift 2 ;;
        --skip-verify) skip_verify=1; shift ;;
        --allow-root) allow_root=1; shift ;;
        --no-start) start=0; shift ;;
        *) echo "unknown option $1. See the top of this file." >&2; exit 2 ;;
    esac
done
say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# the marker is built from two pieces so that filling in the values above leaves this check intact
marker="__FILLED_BY"; marker="${marker}_RELEASE__"
case "$RELEASE_VERSION$REGISTRY$FILES" in
    *"$marker"*) die "this install.sh was not prepared by a release (its checksums are still placeholders). Download install.sh from a release page." ;;
esac
[ -n "$version" ] || die "say which version to install: --version $RELEASE_VERSION"
[ "$version" = "$RELEASE_VERSION" ] || die "this script installs $RELEASE_VERSION, not $version. Download the install.sh of $version."
if [ "$(id -u)" -eq 0 ] && [ "$allow_root" -ne 1 ]; then
    die "do not run this as root. Use a normal user in the docker group or pass --allow-root if you mean it."
fi

command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is missing. See https://docs.docker.com/compose/install/"
for tool in curl openssl; do command -v "$tool" >/dev/null 2>&1 || die "$tool is needed"; done
if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    die "sha256sum or shasum is needed to check the downloads"
fi
if [ "$skip_verify" -ne 1 ]; then
    command -v cosign >/dev/null 2>&1 || die "cosign is needed to verify the image signatures (https://docs.sigstore.dev/cosign/installation/). To skip the check at your own risk pass --skip-verify."
    major="$(cosign version 2>&1 | sed -n 's/^GitVersion:[[:space:]]*v\{0,1\}\([0-9][0-9]*\)\..*/\1/p' | head -n 1)"
    [ "${major:-0}" -ge 3 ] || die "cosign 3 or later is needed: the release is signed in the format version 3 writes. You have: $(cosign version 2>&1 | sed -n 's/^GitVersion:[[:space:]]*//p' | head -n 1)"
fi

[ -n "$base" ] || base="https://github.com/melophos/melophos/releases/download/$version"
case "$base" in
    https://*) proto="=https" ;;
    http://127.0.0.1* | http://localhost* | http://\[::1\]*) proto="=http" ;;
    *) die "downloads must use https (plain http is allowed only for this machine): $base" ;;
esac

# the folder is made private only when this run makes it: an existing one is yours, so it is not changed
created=0
if [ -d "$dir" ]; then
    # shellcheck disable=SC2012
    shown="$(ls -ld "$dir" | cut -c1-10)"
    [ "$(printf '%s' "$shown" | cut -c5-10)" = "------" ] || say "note: $dir is open to other users on this machine ($shown). It will hold your .env, so run: chmod 700 $dir"
else
    mkdir -p "$dir"; chmod 700 "$dir"; created=1
fi
stage="$(mktemp -d "$dir/.stage.XXXXXX")"
finished=0
cleanup() {
    rm -rf "$stage"
    if [ "$finished" -ne 1 ] && [ "$created" -eq 1 ]; then rm -rf "$dir"; fi
}
trap cleanup EXIT

# 2. everything is downloaded and checked in the work folder
umask 077
while read -r sum asset dest _; do
    [ -n "$sum" ] || continue
    say "fetching $asset"
    mkdir -p "$stage/files/$(dirname "$dest")"
    curl -fsSL --proto "$proto" --retry 2 --max-time 120 "$base/$asset" -o "$stage/files/$dest" || die "could not download $base/$asset"
    got="$(sha256 "$stage/files/$dest")"
    [ "$got" = "$sum" ] || die "$asset does not match the checksum in this script (got $got). It may have been changed: stopping."
done <<LIST
$FILES
LIST
compose="$stage/files/docker-compose.yml"

# 3. the work copy of .env
added=""
if [ -L "$dir/.env" ]; then die "$dir/.env is a link. Replace it with a plain file first."; fi
if [ -e "$dir/.env" ]; then
    [ -f "$dir/.env" ] || die "$dir/.env is not a plain file"
    cat "$dir/.env" > "$stage/files/.env"
    added="$(sh "$stage/files/generate-env.sh" --complete "$stage/files/.env")" || die "could not complete .env"
else
    sh "$stage/files/generate-env.sh" > /dev/null || die "could not make .env"
    [ -f "$stage/files/.env" ] || die "generate-env.sh made no .env"
fi

# 4. every image of this release must carry a valid signature and be pinned by digest
images="$(sed -n -E 's/^[[:space:]]+image:[[:space:]]+"?([^" ]+)"?.*$/\1/p' "$compose" | grep "^$REGISTRY/" | sort -u)"
[ -n "$images" ] || die "no image from $REGISTRY in the compose file"
for image in $images; do
    printf '%s' "$image" | grep -Eq '@sha256:[0-9a-f]{64}$' || die "$image is not pinned by digest"
done
if [ "$skip_verify" -eq 1 ]; then
    say "WARNING: signatures are not being verified"
else
    for image in $images; do
        say "verifying the signature of $image"
        insecure=""
        case "$image" in 127.0.0.1* | localhost*) insecure="--allow-insecure-registry" ;; esac
        if [ -n "$key" ]; then
            # a key you hold yourself was not recorded in the public log, so the log is not asked
            # shellcheck disable=SC2086
            cosign verify --key "$key" --insecure-ignore-tlog=true $insecure "$image" > /dev/null || die "the signature of $image is not valid: nothing was changed"
        else
            # the signer is this release's own workflow run, exactly: not another tag, not a branch build
            # shellcheck disable=SC2086
            cosign verify --certificate-identity "$REPO_WORKFLOW@refs/tags/$RELEASE_VERSION" --certificate-oidc-issuer "$ISSUER" $insecure "$image" > /dev/null \
                || die "the signature of $image is not valid: nothing was changed"
        fi
    done
fi

# 5. the move into place. Each file is replaced with one rename, the compose file last
while read -r _ _ dest mode; do
    [ -n "$dest" ] || continue
    [ "$dest" = "docker-compose.yml" ] && continue
    mkdir -p "$dir/$(dirname "$dest")"
    chmod "$mode" "$stage/files/$dest"
    mv -f "$stage/files/$dest" "$dir/$dest"
done <<LIST
$FILES
LIST
if [ ! -e "$dir/.env" ]; then
    mv "$stage/files/.env" "$dir/.env"
elif [ -n "$added" ]; then
    mv -f "$stage/files/.env" "$dir/.env"
    say "added to your .env, with generated values for secrets: $(echo "$added" | tr '\n' ' ')"
fi
# made here so Docker does not make them as root. The broker and Prometheus run as other users inside their containers,
# so what they read has to be readable: the certificates folder and the metrics token (which only opens /metrics)
mkdir -p "$dir/mosquitto/certs" "$dir/monitoring"
chmod 755 "$dir/mosquitto/certs" "$dir/monitoring"
if [ ! -e "$dir/monitoring/metrics_token" ]; then
    printf '%s\n' "$(sed -n 's/^METRICS_TOKEN=//p' "$dir/.env" | tail -n 1)" > "$dir/monitoring/metrics_token"
    chmod 644 "$dir/monitoring/metrics_token"
fi
printf '%s\n' "$RELEASE_VERSION" > "$dir/VERSION"
if [ -f "$dir/docker-compose.yml" ] && ! cmp -s "$compose" "$dir/docker-compose.yml"; then
    cp "$dir/docker-compose.yml" "$stage/previous" && mv -f "$stage/previous" "$dir/docker-compose.yml.previous"
    say "the compose file changed: the old one is kept as docker-compose.yml.previous"
fi
chmod 644 "$compose"
mv -f "$compose" "$dir/docker-compose.yml"
finished=1

if [ "$start" -eq 1 ]; then
    say "starting the stack"
    ( cd "$dir" && docker compose --env-file .env -f docker-compose.yml pull --quiet \
        && docker compose --env-file .env -f docker-compose.yml up -d --wait ) \
        || die "the stack did not start. The files are in place. To go back: copy docker-compose.yml.previous over docker-compose.yml and run docker compose up -d in $dir"
fi

cat <<NEXT

MELOPHOS $version is installed in $dir

Only the images above were signature-checked. The database, Prometheus and Grafana images are pinned by digest
but come from other publishers, who sign differently.

Next:
  1. Put a reverse proxy with TLS in front of http://127.0.0.1:8000 (Caddy or Traefik). The API is published on this machine only.
  2. Open the Studio and create your first account (sign-up is open until you close it).
  3. Pair a hub: it shows a code, type it in the Studio. Hubs reach the broker over TLS on port 8883: see docs/self-hosting.md.
  4. When your household has accounts, set ALLOW_SIGNUP=false in $dir/.env and run: docker compose --env-file .env up -d
  5. Back up: $dir/backup.sh (it holds every secret, so encrypt it: see docs/self-hosting.md). Keep a copy somewhere else.
  6. Update: run the install.sh of the new version with the same --dir. Your .env and data stay.
NEXT
