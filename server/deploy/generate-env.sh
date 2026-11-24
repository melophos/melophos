#!/bin/sh
# Makes .env next to this script from .env.example with every secret replaced by a random value. Needs openssl.
#
#   ./generate-env.sh                  writes .env and refuses when one exists (or is a link)
#   ./generate-env.sh --complete FILE  adds the keys FILE lacks, with random values for secrets and prints the key
#                                      names it added. It never changes a value that is already there
#
# Secrets are written with shell built-ins only, so none is ever an argument of another program that `ps` could show.
# Nothing secret is printed.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
example="$here/.env.example"
rand() { # a failure of openssl must stop the script, which a pipe would hide, so the pieces are kept apart
    raw="$(openssl rand -base64 "$1")" || { echo "openssl could not make a random value" >&2; exit 1; }
    value="$(printf '%s' "$raw" | tr -d '/+=\n')"
    [ -n "$value" ] || { echo "openssl made an empty value" >&2; exit 1; }
    printf '%s' "$value"
}

# the length of the random value a key gets or nothing when the key is not a secret
secret_length() {
    case "$1" in
        SECRET_KEY) echo 48 ;;
        METRICS_TOKEN) echo 32 ;;
        POSTGRES_PASSWORD | POSTGRES_OWNER_PASSWORD | POSTGRES_APP_PASSWORD | MQTT_PASSWORD | MQTT_ADMIN_PASSWORD | GRAFANA_ADMIN_PASSWORD) echo 24 ;;
        *) case "$2" in change-me* | generate-a*) echo 24 ;; esac ;;
    esac
}

line_for() { # key, example value: the line to write
    len="$(secret_length "$1" "$2")"
    if [ -n "$len" ]; then
        secret="$(rand "$len")" || exit 1
        printf '%s=%s\n' "$1" "$secret"
    else
        printf '%s=%s\n' "$1" "$2"
    fi
}

if [ "${1:-}" = "--complete" ]; then
    target="${2:?usage: generate-env.sh --complete FILE}"
    [ -f "$target" ] && [ ! -L "$target" ] || { echo "$target is not a plain file" >&2; exit 1; }
    umask 077
    while IFS= read -r line; do
        case "$line" in
            [A-Z]*=*)
                key="${line%%=*}"
                if ! grep -q "^$key=" "$target"; then
                    line_for "$key" "${line#*=}" >> "$target"
                    echo "$key"
                fi ;;
        esac
    done < "$example"
    exit 0
fi

out="$here/.env"
[ -L "$out" ] && { echo ".env is a link, not writing through it" >&2; exit 1; }
[ -e "$out" ] && { echo ".env already exists, not touching it" >&2; exit 1; }
umask 077
set -C # a file that appears meanwhile makes this fail and is never overwritten
: > "$out" || { echo ".env appeared while this ran, not touching it" >&2; exit 1; }
set +C
ok=0
trap '[ "$ok" -eq 1 ] || rm -f "$out"' EXIT # a half-written file is never left behind. The file is ours from here on
while IFS= read -r line; do
    case "$line" in
        [A-Z]*=*) line_for "${line%%=*}" "${line#*=}" ;;
        *) printf '%s\n' "$line" ;;
    esac
done < "$example" > "$out"
ok=1
echo "wrote $out with random secrets. Check the rest of the file, then start the stack"
