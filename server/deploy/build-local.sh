#!/bin/sh
# Builds the server and broker images from this checkout and runs docker compose with them, so nothing needs to be
# published. With no arguments it builds and starts the stack. With arguments they are passed to docker compose.
#
#   ./build-local.sh                  build and start
#   ./build-local.sh logs -f server   any other docker compose command
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
[ -f "$here/.env" ] || { echo "no .env here: run ./generate-env.sh first" >&2; exit 1; }
[ -d "$root/core/python" ] || { echo "core/ is not part of this checkout, so the engine cannot be built" >&2; exit 1; }

# a copy of the engine's source without its build folder, which can be a gigabyte
core_copy="${MELOPHOS_CORE_DIR:-}"
if [ -z "$core_copy" ]; then
    core_copy="$(mktemp -d)"
    trap 'rm -rf "$core_copy"' EXIT
    (cd "$root/core" && tar --exclude=./target --exclude=.venv -cf - .) | (cd "$core_copy" && tar -xf -)
fi

# with no arguments: build and start
[ "$#" -gt 0 ] || set -- up -d --build --wait

# the base file wants a digest for each published image. These stand-ins are never used: the local file replaces
# the image names with the ones built here
BUILD_EPOCH="$(date +%s)" \
MELOPHOS_CORE_DIR="$core_copy" \
MELOPHOS_SERVER_DIGEST="${MELOPHOS_SERVER_DIGEST:-sha256:local}" \
MELOPHOS_MQTT_DIGEST="${MELOPHOS_MQTT_DIGEST:-sha256:local}" \
    docker compose --env-file "$here/.env" -f "$here/docker-compose.yml" -f "$here/docker-compose.local.yml" "$@"
