#!/bin/sh
# Restores a backup made by backup.sh into this install. Nothing is deleted: the backup is checked first, a safety
# backup of the current data is taken, the dump is restored into a NEW database and the install switches to it only
# when every step worked. The database it replaces is kept under another name. A failure at any step leaves the
# running database as it was.
#
#   ./restore.sh backups/melophos-20261122T120000Z                          the name without the extension
#   ./restore.sh backups/melophos-20261122T120000Z --identity key.txt       when the backup is age-encrypted
#
# It asks you to type yes first. SECRET_KEY is taken from the .env saved with the backup, because it seals the stored
# webhook secrets and has to match the data. The other values stay as they are in this install.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
prefix="" identity="" recipient=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --identity) identity="${2:-}"; shift 2 ;;
        --encrypt) recipient="${2:-}"; shift 2 ;;
        -*) echo "unknown option $1. See the top of this file." >&2; exit 2 ;;
        *) [ -z "$prefix" ] || { echo "one backup at a time" >&2; exit 2; }; prefix="$1"; shift ;;
    esac
done
[ -n "$prefix" ] || { echo "usage: $0 backups/melophos-<stamp> [--identity key.txt]" >&2; exit 2; }
[ -f .env ] || { echo "no .env here" >&2; exit 1; }
if [ -f build-local.sh ]; then compose() { ./build-local.sh "$@"; }; else compose() { docker compose --env-file .env -f docker-compose.yml "$@"; }; fi
fail() { printf 'stopped: %s\nNothing was changed in the running database.\n' "$*" >&2; exit 1; }

envval() { # file, key: the value as text. The file is never run as shell code
    v="$(sed -n "s/^$2=//p" "$1" | tail -n 1)"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
    printf '%s' "$v"
}
pguser="$(envval .env POSTGRES_USER)"
pgdb="$(envval .env POSTGRES_DB)"
[ -n "$pguser" ] && [ -n "$pgdb" ] || fail "POSTGRES_USER and POSTGRES_DB must be set in .env"

umask 077
work="$(mktemp -d)"
newdb="" switched=0 was_running=""
# whatever happens, the dump is removed from inside the database service, a half-made database is dropped and the
# server and worker that this run stopped are started again, unless the switch to the restored data was made
cleanup() {
    rm -rf "$work"
    compose exec -T db rm -f /tmp/restore.dump /tmp/restore.list < /dev/null > /dev/null 2>&1 || true
    if [ -n "$newdb" ] && [ "$switched" -eq 0 ]; then
        # a full disk can crash the database. It is started again first (it restarts by itself, this waits for it)
        compose up -d --wait db < /dev/null > /dev/null 2>&1 || true
        compose exec -T db psql -X -q -U "$pguser" -d postgres -c "DROP DATABASE IF EXISTS \"$newdb\" WITH (FORCE)" < /dev/null > /dev/null 2>&1 || true
    fi
    if [ -n "$was_running" ] && [ "$switched" -eq 0 ]; then
        # shellcheck disable=SC2086
        if compose start $was_running < /dev/null > /dev/null 2>&1; then
            echo "the services stopped for the restore ($(echo "$was_running" | tr '\n' ' ')) were started again on the old data" >&2
        else
            echo "WARNING: could not start $(echo "$was_running" | tr '\n' ' ')again. Run: docker compose --env-file .env up -d" >&2
        fi
    fi
}
trap cleanup EXIT

# the files of the backup, decrypted into a private work folder when they are encrypted
part() { # suffix, name for the work copy: prints the path of a plain copy or nothing when the part is absent
    if [ -f "$prefix$1" ]; then cat "$prefix$1" > "$work/$2"; printf '%s' "$work/$2"
    elif [ -f "$prefix$1.age" ]; then
        [ -n "$identity" ] || fail "$prefix$1.age is encrypted: pass --identity <your age key file>"
        command -v age > /dev/null 2>&1 || fail "age is not installed"
        age -d -i "$identity" "$prefix$1.age" > "$work/$2" || fail "could not decrypt $prefix$1.age with that key"
        printf '%s' "$work/$2"
    fi
}
dump="$(part .dump dump)"
[ -n "$dump" ] || fail "no $prefix.dump (or .dump.age)"
saved_env="$(part .env env)"
[ -n "$saved_env" ] || fail "no $prefix.env: the backup has no saved .env, so SECRET_KEY is not known"
broker="$(part -broker.tar broker.tar)"
[ -f "$prefix.version" ] || fail "no $prefix.version: this backup does not say which version made it"
saved_version="$(sed -n 's/^version=//p' "$prefix.version" | head -n 1)"
current_version="$(cat VERSION 2> /dev/null || echo unknown)"
saved_key="$(envval "$saved_env" SECRET_KEY)"
[ -n "$saved_key" ] || fail "the saved .env has no SECRET_KEY"

# a dump from a newer version may hold tables this version cannot read. An older one is fine: the migrations bring it forward
version_number() { # vMAJOR.MINOR.PATCH to one comparable number or nothing
    printf '%s' "$1" | sed -n 's/^v\([0-9][0-9]*\)\.\([0-9][0-9]*\)\.\([0-9][0-9]*\)$/\1 \2 \3/p' | awk '{ printf "%d", $1 * 1000000 + $2 * 1000 + $3 }'
}
if [ "$saved_version" != "$current_version" ]; then
    a="$(version_number "$saved_version")"; b="$(version_number "$current_version")"
    [ -n "$a" ] && [ -n "$b" ] || fail "the backup is from version $saved_version and this install is $current_version. They cannot be compared, so install the same version first"
    [ "$a" -le "$b" ] || fail "the backup is from $saved_version, which is newer than this install ($current_version). Update first, then restore"
    echo "note: the backup is from $saved_version and this is $current_version. Migrations bring the data forward when the stack starts."
fi

# every command that runs in the database service reads /dev/null: left alone it would swallow the yes typed below
psql_db() { compose exec -T db psql -v ON_ERROR_STOP=1 -X -q -U "$pguser" "$@" < /dev/null; }
compose up -d --wait db > /dev/null || fail "the database service did not start"
# the dump is checked before anything else happens
compose cp "$dump" db:/tmp/restore.dump > /dev/null || fail "could not copy the dump into the database service"
compose exec -T db pg_restore --list /tmp/restore.dump < /dev/null > "$work/list" 2> "$work/list.err" || fail "the dump is not a readable backup: $(head -n 1 "$work/list.err")"
grep -q "TABLE" "$work/list" || fail "the dump holds no tables"
grep -v "EXTENSION" "$work/list" > "$work/list.noext" # the new database gets its extension first
compose cp "$work/list.noext" db:/tmp/restore.list > /dev/null || fail "could not copy the list into the database service"

printf 'This replaces the database "%s" with the backup of %s. The current one is kept under another name. Type yes to go on: ' "$pgdb" "$(sed -n 's/^created=//p' "$prefix.version")"
read -r answer
[ "$answer" = "yes" ] || fail "you did not type yes"

# a safety backup of what is running now. If it cannot be made, nothing else happens. When the backup being restored
# is encrypted its key is the one the safety backup is encrypted for too, unless --encrypt names another
if [ -n "$identity" ] && [ -z "$recipient" ] && command -v age-keygen > /dev/null 2>&1; then
    recipient="$(age-keygen -y "$identity" 2> /dev/null)" || recipient=""
fi
if [ -n "$recipient" ]; then
    "$here/backup.sh" --label pre-restore- --allow-missing-broker --encrypt "$recipient" || fail "the safety backup failed"
else
    "$here/backup.sh" --label pre-restore- --allow-missing-broker || fail "the safety backup failed"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ | tr '[:upper:]' '[:lower:]')"
newdb="${pgdb}_restore_$stamp"
was_running="$(compose ps --status running --services 2> /dev/null < /dev/null | grep -E '^(server|worker)$' || true)"
compose stop server worker > /dev/null 2>&1 || true
psql_db -d postgres -c "CREATE DATABASE \"$newdb\"" || fail "could not make the new database"
psql_db -d "$newdb" -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()" > /dev/null || fail "could not prepare the new database"
compose exec -T db pg_restore -U "$pguser" -d "$newdb" --no-owner --no-privileges --exit-on-error -L /tmp/restore.list /tmp/restore.dump < /dev/null \
    || fail "the restore failed (the new database was removed)"
psql_db -d "$newdb" -c "SELECT timescaledb_post_restore()" > /dev/null || fail "the restore did not finish (the new database was removed)"
compose exec -T db rm -f /tmp/restore.dump /tmp/restore.list < /dev/null

# the switch: two renames. If the second fails the first is undone
old="${pgdb}_replaced_$stamp"
# stop new connections first (TimescaleDB's background workers reconnect on their own), end the old ones and wait until
# the database really has none before the rename: terminating a session is not instant
psql_db -d postgres -c "ALTER DATABASE \"$pgdb\" WITH ALLOW_CONNECTIONS false" > /dev/null || fail "could not stop new connections to the old database"
reopen() { psql_db -d postgres -c "ALTER DATABASE \"$1\" WITH ALLOW_CONNECTIONS true" > /dev/null 2>&1 || true; }
sessions_left=1
for _ in $(seq 1 60); do
    psql_db -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$pgdb' AND pid <> pg_backend_pid()" > /dev/null || { reopen "$pgdb"; fail "could not clear the old connections"; }
    sessions_left="$(psql_db -d postgres -tA -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$pgdb' AND pid <> pg_backend_pid()" 2> /dev/null | tr -d '[:space:]')"
    [ "$sessions_left" = "0" ] && break
    sleep 0.5
done
if [ "$sessions_left" != "0" ]; then
    reopen "$pgdb"
    fail "the old connections did not end within 30 seconds. Nothing was changed in the running database"
fi
if ! psql_db -d postgres -c "ALTER DATABASE \"$pgdb\" RENAME TO \"$old\""; then
    reopen "$pgdb"
    fail "could not set the old database aside"
fi
if ! psql_db -d postgres -c "ALTER DATABASE \"$newdb\" RENAME TO \"$pgdb\""; then
    psql_db -d postgres -c "ALTER DATABASE \"$old\" RENAME TO \"$pgdb\"" || true
    reopen "$pgdb"
    reopen "$old"
    # say it is back only when the database list shows it
    if [ "$(psql_db -d postgres -tA -c "SELECT count(*) FROM pg_database WHERE datname = '$pgdb'" 2> /dev/null | tr -d '[:space:]')" = "1" ] \
        && [ "$(psql_db -d postgres -tA -c "SELECT count(*) FROM pg_database WHERE datname = '$old'" 2> /dev/null | tr -d '[:space:]')" = "0" ]; then
        fail "could not switch to the restored database. The old one is back, checked"
    fi
    was_running="" # starting the services now would point them at a database that is not there
    printf 'stopped: could not switch to the restored database and could not put the old one back.\nYour data is in the database named "%s". To put it back run:\n  docker compose exec db psql -U %s -d postgres -c '"'"'ALTER DATABASE "%s" RENAME TO "%s"'"'"'\n' "$old" "$pguser" "$old" "$pgdb" >&2
    exit 1
fi
switched=1
reopen "$old" # the kept database accepts connections again, so going back is only a rename

# from here the data is the backup's. Take its SECRET_KEY, keeping the old .env beside it
current_key="$(envval .env SECRET_KEY)"
if [ "$current_key" != "$saved_key" ]; then
    kept=".env.before-restore-$stamp" # a name of its own: an earlier one is never overwritten
    cat .env > "$kept"
    while IFS= read -r line; do
        case "$line" in SECRET_KEY=*) printf 'SECRET_KEY=%s\n' "$saved_key" ;; *) printf '%s\n' "$line" ;; esac
    done < "$kept" > "$work/env.new"
    cat "$work/env.new" > .env
    echo "SECRET_KEY now comes from the backup. Your previous .env is kept as $kept"
fi
if [ -n "$broker" ]; then
    compose up -d --wait mqtt > /dev/null && compose exec -T mqtt tar -C /mosquitto -xf - < "$broker" && compose restart mqtt > /dev/null \
        || echo "warning: the broker rules were not restored. Hubs can be paired again" >&2
fi
compose up -d --wait || { echo "the stack did not start on the restored data. To go back: stop it, then in psql rename \"$pgdb\" to something else and \"$old\" to \"$pgdb\"" >&2; exit 1; }
echo "restored $prefix. The database it replaced is kept as \"$old\". When you are sure, remove it with:"
echo "  docker compose exec db psql -U $pguser -d postgres -c 'DROP DATABASE \"$old\"'"
