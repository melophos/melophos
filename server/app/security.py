"""Password hashing, tokens, hashed lookups and rate limits. Nothing here touches HTTP."""

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .db import Pool

ACCOUNT_TOKEN_PREFIX = "mpa_"
DEVICE_SECRET_PREFIX = "mph_"
PAIRING_ALPHABET = (
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0, O, 1, I: the code is read off a screen and typed
)
PAIRING_LENGTH = 8  # 32 ** 8 is about 1.1e12 codes

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.][^@\s]{0,253}\.[^@\s.]{2,63}$")
PASSWORD_MIN = 10
PASSWORD_MAX = 128


def normalise_email(address: str) -> str:
    return address.strip().lower()


def valid_email(address: str) -> bool:
    return len(address) <= 254 and EMAIL_RE.match(address) is not None


def password_problem(password: str, email: str) -> str | None:
    if len(password) < PASSWORD_MIN:
        return f"use at least {PASSWORD_MIN} characters"
    if len(password) > PASSWORD_MAX:
        return f"use at most {PASSWORD_MAX} characters"
    if password.lower() == email.lower() or password.lower() in {"password12", "1234567890", "qwertyuiop"}:
        return "choose something that is not easy to guess"
    return None


class Busy(Exception):
    """Too many password hashes are running at once. The caller answers 503 and the client tries again."""


def broker_password(device_secret: str) -> str:
    """The password a hub uses at the MQTT broker: HMAC-SHA256 keyed with the device secret over the ASCII text
    `mqtt`, as 64 lower case hex characters. The broker stores only a hash of this and a copy of it seen on the
    wire or in the broker's files is useless on the HTTP API, which wants the device secret itself."""
    return hmac.new(device_secret.encode(), b"mqtt", hashlib.sha256).hexdigest()


GATE_FLOOR = 2  # even a one-core machine runs two at once, one of them the reserved place
GATE_CEILING = 8  # each argon2 hash holds about 19 MiB, so eight is about 150 MiB at most
HASH_WAIT_SECONDS = 2.0


def hash_slots(cpus: int) -> int:
    """How many password hashes may run at once: one per processor, never fewer than 2 or more than 8."""
    return max(GATE_FLOOR, min(GATE_CEILING, cpus))


MAX_CONCURRENT_HASHES = hash_slots(os.cpu_count() or 1)


class PasswordService:
    """argon2id with a stored cost and a verify that costs the same whether or not the account exists."""

    def __init__(self, memory_kib: int, time_cost: int, max_concurrent: int | None = None) -> None:
        total = max_concurrent if max_concurrent is not None else MAX_CONCURRENT_HASHES
        # one place is reserved for callers the server already knows (a signed-in owner, an address that has
        # signed in to the account before), so a flood of strangers cannot use every place
        self._general = threading.BoundedSemaphore(max(1, total - 1))
        self._reserved = threading.BoundedSemaphore(1)
        self._hasher = PasswordHasher(time_cost=time_cost, memory_cost=memory_kib, parallelism=1)
        # verifying against this takes as long as a real check, so an unknown address looks like a wrong password
        self._dummy = self._hasher.hash(secrets.token_urlsafe(16))

    @property
    def parameters(self) -> tuple[int, int]:
        return self._hasher._parameters.memory_cost, self._hasher._parameters.time_cost  # noqa: SLF001

    def hash(self, password: str, priority: bool = False) -> str:
        with self._slot(priority):
            return self._hasher.hash(password)

    @contextmanager
    def _slot(self, priority: bool = False) -> Iterator[None]:
        # a bounded number of hashes at once, so a flood is refused fast and cannot use up memory. A caller the
        # server already knows may also use the reserved place
        deadline = time.monotonic() + HASH_WAIT_SECONDS
        while True:
            if self._general.acquire(blocking=False):
                held = self._general
                break
            if priority and self._reserved.acquire(blocking=False):
                held = self._reserved
                break
            if time.monotonic() >= deadline:
                raise Busy
            time.sleep(0.005)
        try:
            yield
        finally:
            held.release()

    def verify(self, stored_hash: str | None, password: str, priority: bool = False) -> bool:
        """Exactly one argon2 verification per call, for a real hash or the dummy."""
        try:
            with self._slot(priority):
                self._hasher.verify(stored_hash or self._dummy, password)
        except (VerificationError, InvalidHashError):
            return False
        return stored_hash is not None

    def needs_rehash(self, stored_hash: str) -> bool:
        return self._hasher.check_needs_rehash(stored_hash)


def new_token(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def token_digest(token: str) -> bytes:
    """Fast hash for tokens that carry 256 bits of randomness, so there is nothing to brute force."""
    return hashlib.sha256(token.encode()).digest()


def new_pairing_code() -> str:
    return "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(PAIRING_LENGTH))


def display_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def normalise_code(text: str) -> str | None:
    cleaned = re.sub(r"[\s-]", "", text).upper()
    if len(cleaned) != PAIRING_LENGTH or any(c not in PAIRING_ALPHABET for c in cleaned):
        return None
    return cleaned


def code_digest(code: str, secret_key: str) -> bytes:
    """Keyed so a copy of the table cannot be searched offline for live codes."""
    return hmac.new(secret_key.encode(), b"pairing:" + code.encode(), hashlib.sha256).digest()


def same(a: bytes, b: bytes) -> bool:
    return hmac.compare_digest(a, b)


GROUP_FULL = -1


class RateLimiter:
    """A sliding window kept as one row per counted event in Postgres, so every server process shares it.

    At any moment the window is the last `seconds` seconds, measured exactly. `hit` allows at most `limit` events in
    any such window, so a burst can never be larger than `limit`. A fixed window would let `limit` through just
    before a boundary and `limit` more just after, which is twice the limit within a few seconds.

    Two shapes are used. `hit` counts every attempt and refuses once the window is full (sign-up, pairing requests,
    uploads). `over` and `add` count only failures, so a success never uses up the allowance (sign-in, pairing guesses).
    """

    def __init__(self, pool: Pool) -> None:
        self._pool = pool

    def count(self, bucket: str, seconds: int) -> int:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT count(*) AS n FROM rate_events WHERE bucket = %s AND at > now() - make_interval(secs => %s)",
                (bucket, seconds),
            ).fetchone()
        assert row is not None
        return int(row["n"])

    def over(self, bucket: str, limit: int, seconds: int) -> bool:
        return self.count(bucket, seconds) >= limit

    def add(self, bucket: str) -> None:
        with self._pool.connection() as conn:
            conn.execute("INSERT INTO rate_events (bucket) VALUES (%s)", (bucket,))

    def hit(self, bucket: str, limit: int, seconds: int) -> bool:
        """Count one attempt if the window has room. False means refuse and nothing is recorded."""
        with self._pool.connection() as conn, conn.transaction():
            # one attempt at a time per bucket, so two requests cannot both take the last place
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (bucket,))
            row = conn.execute(
                "SELECT count(*) AS n FROM rate_events WHERE bucket = %s AND at > now() - make_interval(secs => %s)",
                (bucket, seconds),
            ).fetchone()
            assert row is not None
            if row["n"] >= limit:
                return False
            conn.execute("INSERT INTO rate_events (bucket) VALUES (%s)", (bucket,))
            return True

    def reserve(self, bucket: str, limit: int, seconds: int) -> int | None:
        """Take a place in the window before the work starts, under the bucket's lock, so parallel attempts cannot
        all be judged against the same count. Returns a ticket or None when the window is full. A caller whose
        attempt succeeds hands the ticket back with `release`."""
        with self._pool.connection() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (bucket,))
            row = conn.execute(
                "SELECT count(*) AS n FROM rate_events WHERE bucket = %s AND at > now() - make_interval(secs => %s)",
                (bucket, seconds),
            ).fetchone()
            assert row is not None
            if row["n"] >= limit:
                return None
            ticket = conn.execute(
                "INSERT INTO rate_events (bucket) VALUES (%s) RETURNING id", (bucket,)
            ).fetchone()
            assert ticket is not None
            return int(ticket["id"])

    def reserve_in_group(
        self, bucket: str, limit: int, seconds: int, group: str, group_limit: int
    ) -> int | None:
        """Like `reserve` and also refuses a bucket that would be the (group_limit+1)th different one in its group in
        the window. Used to stop one address trying many different accounts. Buckets already in the window may keep
        going up to their own limit."""
        with self._pool.connection() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (group,))
            mine = conn.execute(
                "SELECT count(*) AS n FROM rate_events WHERE bucket = %s AND at > now() - make_interval(secs => %s)",
                (bucket, seconds),
            ).fetchone()
            others = conn.execute(
                "SELECT count(DISTINCT bucket) AS n FROM rate_events WHERE bucket LIKE %s"
                " AND at > now() - make_interval(secs => %s)",
                (group + "%", seconds),
            ).fetchone()
            assert mine is not None and others is not None
            if mine["n"] >= limit:
                return None
            if mine["n"] == 0 and others["n"] >= group_limit:
                return GROUP_FULL
            ticket = conn.execute(
                "INSERT INTO rate_events (bucket) VALUES (%s) RETURNING id", (bucket,)
            ).fetchone()
            assert ticket is not None
            return int(ticket["id"])

    def release(self, *tickets: int | None) -> None:
        wanted = [t for t in tickets if t is not None]
        if wanted:
            with self._pool.connection() as conn:
                conn.execute("DELETE FROM rate_events WHERE id = ANY(%s)", (wanted,))

    def purge(self) -> int:
        with self._pool.connection() as conn:
            cur = conn.execute("DELETE FROM rate_events WHERE at < now() - interval '1 day'")
            return cur.rowcount
