"""Collects a build's flash images and writes the manifest ESP Web Tools reads.

    pio run -e esp32-s3 -e esp32-bringup
    python make_manifest.py --version 0.1.0 --out dist/

The offsets are the ones the ROM bootloader and partitions.csv fix: the second
stage bootloader at 0x0 on the ESP32-S3 and 0x1000 on the classic ESP32, the
partition table at 0x8000, boot_app0 at 0xe000 and the first app slot at
0x10000. The script checks the last against partitions.csv so the two cannot
drift apart.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

FIRMWARE = Path(__file__).resolve().parent.parent
BOOT_APP0 = Path.home() / ".platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
TARGETS = {
    "esp32-s3": {"chip": "ESP32-S3", "bootloader": 0x0},
    "esp32-bringup": {"chip": "ESP32", "bootloader": 0x1000},
}


def app_offset(partitions: Path) -> int:
    for line in partitions.read_text().splitlines():
        fields = [f.strip() for f in line.split(",")]
        if len(fields) >= 5 and fields[0] == "app0":
            return int(fields[3], 16)
    raise SystemExit("partitions.csv has no app0 partition")


def build(version: str, out: Path, boot_app0: Path = BOOT_APP0, build_dir: Path = FIRMWARE / ".pio/build") -> dict:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise SystemExit("version must look like 0.1.0")
    firmware_offset = app_offset(FIRMWARE / "partitions.csv")
    out.mkdir(parents=True, exist_ok=True)
    builds = []
    for env, target in TARGETS.items():
        parts = []
        for name, offset, source in (
            ("bootloader.bin", target["bootloader"], build_dir / env / "bootloader.bin"),
            ("partitions.bin", 0x8000, build_dir / env / "partitions.bin"),
            ("boot_app0.bin", 0xE000, boot_app0),
            ("firmware.bin", firmware_offset, build_dir / env / "firmware.bin"),
        ):
            if not source.is_file():
                raise SystemExit(f"missing {source}: run pio run -e {env} first")
            destination = f"{env}-{name}"
            shutil.copyfile(source, out / destination)
            parts.append({"path": destination, "offset": offset})
        builds.append({"chipFamily": target["chip"], "parts": parts})
    manifest = {"name": "MELOPHOS hub", "version": version, "new_install_prompt_erase": True, "builds": builds}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build(args.version, args.out)
    print(f"wrote {args.out}/manifest.json. Copy index.html next to it and serve the folder over https")
    return 0


if __name__ == "__main__":
    sys.exit(main())
