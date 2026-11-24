"""Checks every profile against schema.json and the invalid corpus against both
the schema and the hub's limits.

    python -m venv .venv && .venv/bin/pip install jsonschema
    .venv/bin/python check_profiles.py

The hub firmware has further limits a schema cannot express (the LED count must
fit the strip, lowest must not be above highest). Those files are listed in
FIRMWARE_ONLY and are accepted by the schema on purpose: the firmware test
`test_invalid_corpus_is_refused_with_a_message` refuses them.
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

HERE = Path(__file__).parent
FIRMWARE_ONLY = {"leds-too-many", "lowest-above-highest", "grid-on-keyboard"}


def main() -> int:
    schema = json.loads((HERE / "schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    failures = []
    for path in sorted(HERE.glob("*.json")):
        if path.name == "schema.json":
            continue
        for error in validator.iter_errors(json.loads(path.read_text())):
            failures.append(f"{path.name} should be valid: {error.message}")
    for path in sorted((HERE / "invalid").glob("*.json")):
        try:
            document = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue  # not JSON at all, so also refused
        errors = list(validator.iter_errors(document))
        if path.stem in FIRMWARE_ONLY:
            if errors:
                failures.append(f"invalid/{path.name} is listed as firmware-only but the schema refuses it")
        elif not errors:
            failures.append(f"invalid/{path.name} should be refused by the schema")
    for line in failures:
        print(line)
    print("profiles: ok" if not failures else f"profiles: {len(failures)} problem(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
