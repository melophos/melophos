#!/bin/sh
# Proves the Python signing tool and the device agree: signs a random image with
# a key made for this run, then has the host test verify it through the same
# code the hub runs. The key lives in a temporary folder outside the repository
# and is removed at the end.
#
#   python -m venv .venv && .venv/bin/pip install cryptography
#   PATH="$PWD/.venv/bin:$PATH" tools/check_signing.sh
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
head -c 150000 /dev/urandom > "$work/raw.bin"
python3 "$here/tools/sign_image.py" keygen --secret "$work/update.key" --public "$work/public.key"
python3 "$here/tools/sign_image.py" sign --key "$work/update.key" --image "$work/raw.bin" --version 10001 --board s3 --out "$work"
cd "$here"
MELOPHOS_SIGN_FIXTURE="$work" pio test -e native -f test_ota
