#!/bin/sh
# Run by a release, never by a user. Takes the deploy files, writes the image digests into the compose file, writes
# the version and the checksums of every file an install downloads into install.sh and lists all of them in SHA256SUMS.
# Everything goes to a new folder, so the files in the repository are never changed and a release publishes exactly
# the files it pinned.
#
#   ./pin-release.sh --version v1.2.3 --server-digest sha256:... --mqtt-digest sha256:... --out DIR [--registry HOST/PATH]
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
version="" server="" mqtt="" registry="ghcr.io/melophos" out=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --version) version="${2:-}"; shift 2 ;;
        --server-digest) server="${2:-}"; shift 2 ;;
        --mqtt-digest) mqtt="${2:-}"; shift 2 ;;
        --registry) registry="${2:-}"; shift 2 ;;
        --out) out="${2:-}"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
digest_ok() { printf '%s' "$1" | grep -Eq '^sha256:[0-9a-f]{64}$'; }
printf '%s' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo "--version must look like v1.2.3" >&2; exit 2; }
digest_ok "$server" || { echo "--server-digest must be sha256: and 64 hex characters" >&2; exit 2; }
digest_ok "$mqtt" || { echo "--mqtt-digest must be sha256: and 64 hex characters" >&2; exit 2; }
[ -n "$out" ] || { echo "--out DIR is needed" >&2; exit 2; }
mkdir -p "$out"
out="$(cd "$out" && pwd)"
[ "$out" != "$here" ] || { echo "--out must not be the deploy folder itself" >&2; exit 2; }

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

cp "$here/generate-env.sh" "$here/backup.sh" "$here/restore.sh" "$here/install.sh" "$out/"
cp "$here/.env.example" "$out/env.example" # a release asset cannot start with a dot
cp "$here/monitoring/prometheus.yml" "$out/prometheus.yml"

# each placeholder is the whole ${...} expression up to its closing brace
sed -e "s|ghcr.io/melophos/melophos-server@\${MELOPHOS_SERVER_DIGEST:?[^}]*}|$registry/melophos-server@$server|" \
    -e "s|ghcr.io/melophos/melophos-mqtt@\${MELOPHOS_MQTT_DIGEST:?[^}]*}|$registry/melophos-mqtt@$mqtt|" \
    -e "/^# TEMPLATE-NOTE-BEGIN/,/^# TEMPLATE-NOTE-END/c\\
# release $version. The image digests below were filled in by deploy/pin-release.sh." \
    "$here/docker-compose.yml" | sed -E 's/^([[:space:]]*image:) "([^"]*)"/\1 \2/' > "$out/docker-compose.yml"
if grep -q 'MELOPHOS_[A-Z]*_DIGEST' "$out/docker-compose.yml"; then
    echo "a digest placeholder is still in the compose file" >&2; exit 1
fi

# checksum, name in the release, place in the install folder, mode
block="$(mktemp)"
{
    printf '%s docker-compose.yml docker-compose.yml 644\n' "$(sha256 "$out/docker-compose.yml")"
    printf '%s env.example .env.example 644\n' "$(sha256 "$out/env.example")"
    printf '%s generate-env.sh generate-env.sh 755\n' "$(sha256 "$out/generate-env.sh")"
    printf '%s backup.sh backup.sh 755\n' "$(sha256 "$out/backup.sh")"
    printf '%s restore.sh restore.sh 755\n' "$(sha256 "$out/restore.sh")"
    printf '%s prometheus.yml monitoring/prometheus.yml 644\n' "$(sha256 "$out/prometheus.yml")"
} > "$block"
tmp="$(mktemp)"
awk -v block="$block" -v version="$version" -v registry="$registry" '
    /^# BEGIN FILES/ { print; print "FILES=\""; while ((getline l < block) > 0) print l; print "\""; skipping = 1; next }
    /^# END FILES/ { skipping = 0 }
    skipping { next }
    /^RELEASE_VERSION=/ { print "RELEASE_VERSION=\"" version "\""; next }
    /^REGISTRY=/ { print "REGISTRY=\"" registry "\""; next }
    { print }
' "$out/install.sh" > "$tmp"
cat "$tmp" > "$out/install.sh"
rm -f "$tmp" "$block"
chmod 755 "$out/install.sh" "$out/generate-env.sh" "$out/backup.sh" "$out/restore.sh"

( cd "$out" && for f in install.sh docker-compose.yml env.example generate-env.sh backup.sh restore.sh prometheus.yml; do
    printf '%s  %s\n' "$(sha256 "$f")" "$f"; done > SHA256SUMS )
echo "pinned $version in $out"
