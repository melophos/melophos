"""Signs a firmware image for the hub's Wi-Fi update.

    python tools/sign_image.py keygen --secret ~/melophos-update.key --public update.pub
    python tools/sign_image.py sign --key ~/melophos-update.key --image .pio/build/esp32-s3/firmware.bin \
        --version 10001 --board s3 --out dist/

The manifest layout is documented in lib/ota/ota.h. The secret key is 32
random bytes in a file you keep OUTSIDE this repository: keygen refuses to
write it anywhere inside a git work tree and the tool never prints it. Needs
the `cryptography` package.
"""

import argparse
import hashlib
import os
import struct
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

BOARDS = {"s3": 1, "bringup": 2}
MANIFEST_FORMAT = 1


def inside_git_tree(path: Path) -> bool:
    for parent in [path.resolve().parent, *path.resolve().parents]:
        if (parent / ".git").exists():
            return True
    return False


def public_bytes(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def keygen(secret: Path, public: Path) -> int:
    if inside_git_tree(secret):
        print("refusing to write a secret key inside a git work tree", file=sys.stderr)
        return 2
    seed = os.urandom(32)
    fd = os.open(secret, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(seed)
    public.write_bytes(public_bytes(Ed25519PrivateKey.from_private_bytes(seed)))
    # only the public file is named: nothing about the secret key, not even where it was written, reaches the output
    print(f"wrote {public} (32 bytes, safe to publish). The secret key went to the file given with --secret")
    return 0


def build_manifest(key: Ed25519PrivateKey, image: bytes, version: int, board: int) -> bytes:
    if not 0 < version < 2**32:
        raise ValueError("version must be a positive 32 bit integer")
    if not image:
        raise ValueError("the image is empty")
    body = b"MLPH" + struct.pack("<BBH", MANIFEST_FORMAT, board, 0) + struct.pack("<II", version, len(image))
    body += hashlib.sha512(image).digest()
    assert len(body) == 80
    return body + key.sign(body)


def sign(key_path: Path, image_path: Path, version: int, board: str, out: Path) -> int:
    seed = key_path.read_bytes()
    if len(seed) != 32:
        print("the key file must hold exactly 32 bytes", file=sys.stderr)
        return 2
    key = Ed25519PrivateKey.from_private_bytes(seed)
    image = image_path.read_bytes()
    manifest = build_manifest(key, image, version, BOARDS[board])
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.bin").write_bytes(manifest)
    (out / "image.bin").write_bytes(image)
    print(f"signed {len(image)} bytes as version {version} for {board}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("keygen")
    gen.add_argument("--secret", type=Path, required=True)
    gen.add_argument("--public", type=Path, required=True)
    sg = sub.add_parser("sign")
    sg.add_argument("--key", type=Path, required=True)
    sg.add_argument("--image", type=Path, required=True)
    sg.add_argument("--version", type=int, required=True)
    sg.add_argument("--board", choices=sorted(BOARDS), required=True)
    sg.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "keygen":
        return keygen(args.secret, args.public)
    return sign(args.key, args.image, args.version, args.board, args.out)


if __name__ == "__main__":
    sys.exit(main())
