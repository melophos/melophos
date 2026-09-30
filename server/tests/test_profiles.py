"""Profiles are shared by every component, so each must validate. Skipped outside the monorepo."""

import json
from pathlib import Path

import pytest

PROFILES = Path(__file__).resolve().parents[2] / "profiles"

pytestmark = pytest.mark.skipif(not PROFILES.is_dir(), reason="profiles/ is not part of this checkout")


def profile_files():
    return sorted(p for p in PROFILES.glob("*.json") if p.name != "schema.json") if PROFILES.is_dir() else []


@pytest.mark.parametrize("path", profile_files(), ids=lambda p: p.name)
def test_profile_matches_schema(path):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((PROFILES / "schema.json").read_text())
    profile = json.loads(path.read_text())
    jsonschema.validate(profile, schema)
    assert profile["id"] == path.stem


@pytest.mark.parametrize("path", profile_files(), ids=lambda p: p.name)
def test_keyboard_range_is_ordered(path):
    profile = json.loads(path.read_text())
    if profile["type"] == "keyboard":
        assert profile["notes"]["lowest"] < profile["notes"]["highest"]
