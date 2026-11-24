#!/bin/sh
# Builds the scoring engine's Linux wheel into server/wheels/ with Docker, from core/ as it is on disk.
# CI does the same job once and shares the wheel as the artifact `melophos-core-wheel`, so a local build and CI
# give the same image input. The Dockerfile refuses to build without a wheel in server/wheels/.
set -eu
here="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$here/server/wheels"
docker run --rm \
    -v "$here/core:/src:ro" \
    -v "$here/server/wheels:/out" \
    -e CARGO_TARGET_DIR=/tmp/target \
    rust:1.85-slim-bookworm sh -c '
        apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 python3-pip python3-venv >/dev/null &&
        python3 -m venv /tmp/v && /tmp/v/bin/pip install -q "maturin>=1.7,<2" &&
        cd /src && /tmp/v/bin/maturin build --release --locked --manifest-path python/Cargo.toml --out /out'
ls "$here/server/wheels"
