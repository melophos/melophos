#!/bin/sh
# Backs up the database (with its time series), the broker's rules and a copy of .env into ./backups and records
# which version made them. Run it from the folder that holds docker-compose.yml and .env.
#
#   ./backup.sh                          plain files
#   ./backup.sh --encrypt age1...        encrypted with age: the recipient is a public key or a file of them
#
# READ THIS: a backup holds every secret of the install. The copy of .env has the database passwords, SECRET_KEY and
# the broker password and the dump holds every account's data. Anyone who can read the files can read all of it.
# Without --encrypt they are plain files (readable by you only), so move them somewhere private and never to a
# shared drive. SECRET_KEY has to be kept with the data: without it the stored webhook secrets cannot be read.
set -eu
cd "$(dirname "$0")"
recipient="" label="" allow_no_broker=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --encrypt) recipient="${2:-}"; shift 2 ;;
        --label) label="${2:-}"; shift 2 ;;
        --allow-missing-broker) allow_no_broker=1; shift ;;
        *) echo "unknown option $1. See the top of this file." >&2; exit 2 ;;
    esac
done
[ -f .env ] || { echo "no .env here" >&2; exit 1; }
if [ -f build-local.sh ]; then compose() { ./build-local.sh "$@"; }; else compose() { docker compose --env-file .env -f docker-compose.yml "$@"; }; fi

# values are read from the file as text. It is never run as shell code, so a value with a space or a ; is harmless
envval() { # key
    v="$(sed -n "s/^$1=//p" .env | tail -n 1)"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
    printf '%s' "$v"
}
pguser="$(envval POSTGRES_USER)"
pgdb="$(envval POSTGRES_DB)"
[ -n "$pguser" ] && [ -n "$pgdb" ] || { echo "POSTGRES_USER and POSTGRES_DB must be set in .env" >&2; exit 1; }

# the recipient is a public key or the path of a file of them. It is quoted wherever it is used, so a path with a space works
age_encrypt() { if [ -f "$recipient" ]; then age -R "$recipient"; else age -r "$recipient"; fi; }
if [ -n "$recipient" ]; then
    command -v age >/dev/null 2>&1 || { echo "age is not installed (https://github.com/FiloSottile/age)" >&2; exit 1; }
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="backups/${label}melophos-$stamp"
umask 077
mkdir -p backups
chmod 700 backups
work="$(mktemp -d backups/.partial.XXXXXX)"
trap 'rm -rf "$work"' EXIT

# runs a command and keeps what it prints in the backup, encrypted when asked. The command's own result is checked:
# a pipe would hide it, so it is kept in a file
broker_tar() { compose exec -T mqtt tar -C /mosquitto -cf - data < /dev/null; }
pg_dump_in_db() { compose exec -T db pg_dump -U "$pguser" -Fc "$pgdb" < /dev/null; }
keep() { # name, command...
    name="$1"; shift
    status="$work/status"
    if [ -n "$recipient" ]; then
        { if "$@"; then echo 0 > "$status"; else echo 1 > "$status"; fi; } | age_encrypt > "$work/$name.age" || { echo "encryption failed" >&2; exit 1; }
        name="$name.age"
    else
        if "$@" > "$work/$name"; then echo 0 > "$status"; else echo 1 > "$status"; fi
    fi
    [ "$(cat "$status" 2> /dev/null)" = "0" ] || { echo "could not take $name" >&2; exit 1; }
    [ -s "$work/$name" ] || { echo "$name came out empty" >&2; exit 1; }
}

keep dump pg_dump_in_db
if compose ps --status running --services 2> /dev/null | grep -qx mqtt; then
    keep broker.tar broker_tar
elif [ "$allow_no_broker" -eq 1 ]; then
    echo "note: the broker is not running, so its rules are not in this backup" >&2
else
    echo "the broker is not running, so its rules cannot be backed up. Start the stack or pass --allow-missing-broker" >&2
    exit 1
fi
keep env cat .env
{
    echo "version=$(cat VERSION 2> /dev/null || echo unknown)"
    echo "server_image=$(sed -n -E 's/^[[:space:]]+image:[[:space:]]+"?([^" ]*melophos-server[^" ]*)"?.*$/\1/p' docker-compose.yml | head -n 1)"
    echo "created=$stamp"
    echo "encrypted=$([ -n "$recipient" ] && echo yes || echo no)"
} > "$work/version"

# move into place only when every part is complete: a half backup never looks like a whole one
for f in "$work"/*; do
    n="$(basename "$f")"
    case "$n" in
        dump*) mv "$f" "$base.${n}" ;;
        broker.tar*) mv "$f" "$base-${n}" ;;
        env*) mv "$f" "$base.${n}" ;;
        version) mv "$f" "$base.version" ;;
    esac
done
rm -f "$work/status"
echo "backup written: $base (version $(sed -n 's/^version=//p' "$base.version"))"
if [ -z "$recipient" ]; then echo "WARNING: the files are not encrypted and hold every secret. Use --encrypt, see docs/self-hosting.md"; fi
