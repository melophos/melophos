import json
import tempfile
import unittest
from pathlib import Path

import make_manifest


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.builds = self.tmp / "builds"
        for env in make_manifest.TARGETS:
            (self.builds / env).mkdir(parents=True)
            for name in ("bootloader.bin", "partitions.bin", "firmware.bin"):
                (self.builds / env / name).write_bytes(name.encode())
        self.boot_app0 = self.tmp / "boot_app0.bin"
        self.boot_app0.write_bytes(b"b")

    def test_offsets_match_the_partition_table(self):
        manifest = make_manifest.build("0.1.0", self.tmp / "out", self.boot_app0, self.builds)
        by_chip = {b["chipFamily"]: {p["path"].split("-", 2)[-1]: p["offset"] for p in b["parts"]} for b in manifest["builds"]}
        self.assertEqual(by_chip["ESP32-S3"]["bootloader.bin"], 0x0)
        self.assertEqual(by_chip["ESP32"]["bootloader.bin"], 0x1000)
        for chip in by_chip.values():
            self.assertEqual(chip["partitions.bin"], 0x8000)
            self.assertEqual(chip["boot_app0.bin"], 0xE000)
            self.assertEqual(chip["firmware.bin"], 0x10000)
        written = json.loads((self.tmp / "out/manifest.json").read_text())
        self.assertEqual(written, manifest)

    def test_a_missing_image_stops_the_build(self):
        (self.builds / "esp32-s3/firmware.bin").unlink()
        with self.assertRaises(SystemExit):
            make_manifest.build("0.1.0", self.tmp / "out", self.boot_app0, self.builds)

    def test_a_bad_version_is_refused(self):
        with self.assertRaises(SystemExit):
            make_manifest.build("latest", self.tmp / "out", self.boot_app0, self.builds)


if __name__ == "__main__":
    unittest.main()
