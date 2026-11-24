#!/bin/sh
# Writes the three hashed lock files the image installs with --require-hashes:
#   requirements.lock         what the server and worker need to run
#   requirements-build.lock   what builds the server package itself (setuptools)
#   requirements-engine.lock  what builds the scoring engine (maturin)
# The date below is part of the lock: nothing published after it can enter, so the same command gives the same files
# on any day. Move it forward on purpose when you update, then commit the three files. CI runs this script with
# the same uv version and fails when the files differ, which is how a changed range in pyproject.toml is caught.
# Needs uv 0.13.9 (pip install uv==0.13.9).
set -eu
cd "$(dirname "$0")"
DATE="2026-11-20T00:00:00Z"
# each lock is made for the one Python version it runs on: the server image is Python 3.14 and the engine is built in a
# Debian 12 stage, which has Python 3.11 (see server/Dockerfile)
compile() { # input, output, python version
    uv pip compile "$1" --universal --generate-hashes --python-version "$3" --exclude-newer "$DATE" -q -o "$2"
}
compile pyproject.toml requirements.lock 3.14
compile requirements-build.in requirements-build.lock 3.14
compile requirements-engine.in requirements-engine.lock 3.11
