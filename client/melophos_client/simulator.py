"""Plays a practice session as if a hub were connected.

Usage: melophos-sim --profile profiles/piano-88.json [--server URL] [--dry-run]
"""

import argparse
import json
import random
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .api import Client

MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11, 12)


def playable_notes(profile: dict[str, Any]) -> tuple[int, int]:
    if profile["type"] == "keyboard":
        return profile["notes"]["lowest"], profile["notes"]["highest"]
    strings: list[int] = profile["strings"]
    return min(strings), max(strings) + int(profile["frets"])


def scale_session(
    profile: dict[str, Any],
    tonic: int = 60,
    tempo_bpm: int = 90,
    repeats: int = 2,
    seed: int | None = None,
) -> list[dict[str, int]]:
    """A C major scale up and down, with human timing and velocity wobble."""
    rng = random.Random(seed)
    lowest, highest = playable_notes(profile)
    beat_ms = 60_000 // tempo_bpm
    run = [tonic + step for step in MAJOR_SCALE]
    run += run[-2::-1]
    events: list[dict[str, int]] = []
    t = 0
    for _ in range(repeats):
        for note in run:
            if not lowest <= note <= highest:
                continue
            on = max(0, t + rng.randint(-25, 25))
            events.append({"t_ms": on, "note": note, "velocity": rng.randint(55, 100)})
            events.append({"t_ms": on + int(beat_ms * 0.8), "note": note, "velocity": 0})
            t += beat_ms
    return sorted(events, key=lambda e: e["t_ms"])


def build_session(profile: dict[str, Any], device_id: str, seed: int | None = None) -> dict[str, Any]:
    return {
        "device_id": device_id,
        "profile_id": profile["id"],
        "started_at": datetime.now(UTC).isoformat(),
        "mode": "free",
        "events": scale_session(profile, seed=seed),
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="melophos-sim", description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--server", default="http://localhost:8000")
    parser.add_argument("--device-id", default="sim-hub")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--dry-run", action="store_true", help="print the session instead of sending it")
    args = parser.parse_args(argv)

    profile = json.loads(args.profile.read_text())
    session = build_session(profile, args.device_id, seed=args.seed)
    if args.dry_run:
        print(json.dumps(session, indent=2))
        return
    client = Client(args.server)
    try:
        stored = client.post_session(session)
    finally:
        client.close()
    summary = stored["summary"]
    print(f"session {stored['id']}: {summary['notes_played']} notes in {summary['duration_ms'] / 1000:.1f} s")


if __name__ == "__main__":
    main()
