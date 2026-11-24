"""Plays a practice session as if a hub were connected.

Pair once, then play over HTTP or MQTT:

    melophos-sim --pair --server http://localhost:8000
    melophos-sim --profile profiles/piano-88.json --server http://localhost:8000
    melophos-sim --profile profiles/piano-88.json --mqtt localhost:1883

Pairing prints a code. Type it into the Studio signed in to your account and the simulator is your hub.
The credential is saved to --credentials (owner-only) and reused.
"""

import argparse
import json
import random
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .api import Client
from .credentials import Credentials
from .mqtt import run_session

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


def build_session(profile: dict[str, Any], seed: int | None = None) -> dict[str, Any]:
    return {
        "profile_id": profile["id"],
        "started_at": datetime.now(UTC).isoformat(),
        "mode": "free",
        "events": scale_session(profile, seed=seed),
    }


DEFAULT_CREDENTIALS = Path.home() / ".melophos-sim.json"
PAIR_WAIT_S = 600


def pair(server: str, path: Path, wait_s: float = PAIR_WAIT_S, poll_s: float = 2.0) -> Credentials:
    client = Client(server)
    try:
        started = client.start_pairing()
        creds = Credentials(server, started["device_id"], started["device_secret"])
        creds.save(path)
        print(f"pairing code {started['code']} (valid {started['expires_in'] // 60} minutes)")
        print("type it into the Studio, signed in to your account")
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            if client.device_status()["paired"]:
                print(f"paired as {creds.device_id}")
                return creds
            time.sleep(poll_s)
    finally:
        client.close()
    raise SystemExit("the code expired before it was typed in: run --pair again")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="melophos-sim", description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--server", default="http://localhost:8000")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument(
        "--pair", action="store_true", help="get a pairing code and wait for the owner to type it"
    )
    parser.add_argument("--mqtt", metavar="HOST:PORT", help="publish over MQTT instead of HTTP")
    parser.add_argument(
        "--mqtt-tls",
        action="store_true",
        help="use TLS to the broker (port 8883). Plain 1883 is for development only",
    )
    parser.add_argument(
        "--mqtt-ca",
        metavar="FILE",
        help="the certificate authority to trust for the broker, if the system does not know it",
    )
    parser.add_argument("--seed", type=int)
    parser.add_argument("--dry-run", action="store_true", help="print the session instead of sending it")
    args = parser.parse_args(argv)

    if args.pair:
        pair(args.server, args.credentials)
        return
    if args.profile is None:
        parser.error("--profile is required unless --pair is used")
    profile = json.loads(args.profile.read_text())
    session = build_session(profile, seed=args.seed)
    if args.dry_run:
        print(json.dumps(session, indent=2))
        return
    if not args.credentials.exists():
        raise SystemExit(f"no credentials at {args.credentials}: run melophos-sim --pair first")
    creds = Credentials.load(args.credentials)

    if args.mqtt:
        host, _, port = args.mqtt.partition(":")
        if not args.mqtt_tls:
            print(
                "warning: plain MQTT sends the device secret unencrypted, use --mqtt-tls outside development",
                file=sys.stderr,
            )
        creds.boot += 1  # a new run is a new power-up, so message counters start again
        creds.save(args.credentials)
        report = run_session(
            host,
            int(port or (8883 if args.mqtt_tls else 1883)),
            creds.device_id,
            creds.device_secret,
            creds.boot,
            profile["id"],
            session["events"],
            tls=args.mqtt_tls,
            ca_file=args.mqtt_ca,
        )
        print(f"published {report.sent} messages for session {report.session_ref}")
        if report.refused:
            raise SystemExit(f"the broker refused: {', '.join(report.refused)}")
        return

    client = Client(creds.server, device_id=creds.device_id, device_secret=creds.device_secret)
    try:
        stored = client.post_session(session)
    finally:
        client.close()
    summary = stored["summary"]
    print(f"session {stored['id']}: {summary['notes_played']} notes in {summary['duration_ms'] / 1000:.1f} s")


if __name__ == "__main__":
    main()
