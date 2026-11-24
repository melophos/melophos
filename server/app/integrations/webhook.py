"""Session webhook payload and signature, so external dashboards get practice data without polling.

A receiver checks a delivery like this (the README has the same example in full):

    expected = sign(secret, headers["Melophos-Timestamp"], body)
    ok = hmac.compare_digest(expected, headers["Melophos-Signature"]) and abs(now - int(timestamp)) <= 300
"""

import hashlib
import hmac
import time

from ..schemas import PracticeSessionOut

SIGNATURE_VERSION = "v1"
TOLERANCE_SECONDS = 300


def payload_for(session: PracticeSessionOut) -> dict[str, object]:
    return {
        "event": "session.finished",
        "session_id": str(session.id),
        "device_id": session.device_id,
        "profile_id": session.profile_id,
        "started_at": session.started_at.isoformat(),
        "summary": session.summary.model_dump(),
    }


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """`v1=<hex>`: HMAC-SHA256 over `<timestamp>.<body>`. The timestamp is inside the signature, so it cannot be changed."""
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    return f"{SIGNATURE_VERSION}={mac.hexdigest()}"


def verify(
    secret: str,
    timestamp: str,
    signature: str,
    body: bytes,
    *,
    now: float | None = None,
    tolerance: int = TOLERANCE_SECONDS,
) -> bool:
    """What a receiver runs. False for a bad signature or a delivery older (or newer) than the tolerance."""
    if not timestamp.isdigit():
        return False
    current = time.time() if now is None else now
    if abs(current - int(timestamp)) > tolerance:
        return False
    return hmac.compare_digest(sign(secret, timestamp, body), signature)
