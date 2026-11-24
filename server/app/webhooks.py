"""Webhook endpoints, the delivery queue and the dispatcher.

A finished session inserts one pending delivery per matching endpoint inside the same transaction that finished
it. Nothing is sent there: the dispatcher (run by the worker) picks deliveries up later, so a slow or dead
receiver can never slow down or fail the request that stored the session.
"""

import base64
import hashlib
import json
import logging
import os
import random
import secrets
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .db import Pool, Row
from .integrations.webhook import payload_for, sign
from .outbound import Resolver, SendResult, post_json, system_resolver
from .schemas import PracticeSessionOut

log = logging.getLogger("melophos.webhooks")

# seconds to wait after the 1st, 2nd, 3rd, 4th and 5th failed attempt. A delivery is tried 6 times in about 7 hours
RETRY_DELAYS = (30, 120, 600, 3600, 21600)
MAX_ATTEMPTS = len(RETRY_DELAYS) + 1
JITTER = 0.2  # each delay varies by up to 20 percent so many failing endpoints do not retry in step
DISABLE_AFTER = 10  # consecutive failed attempts before an endpoint is switched off
LEASE_SECONDS = 120  # hidden from other workers for this long. A batch finishes well inside it
BATCH = 20
POOL = 8  # sends at the same time
PER_ACCOUNT = 2  # deliveries of one account in a batch, so one account cannot use the whole pool
MAX_ENDPOINTS_PER_ACCOUNT = 5
SECRET_PREFIX = "whsec_"


class EndpointLimit(Exception):
    pass


class SecretBox:
    """AES-256-GCM for endpoint secrets. They must be readable to sign, so a one-way hash is not an option."""

    def __init__(self, secret_key: str) -> None:
        self._key = hashlib.sha256(b"melophos webhook secrets\0" + secret_key.encode()).digest()

    def seal(self, endpoint_id: UUID, secret: str) -> bytes:
        nonce = os.urandom(12)
        return nonce + AESGCM(self._key).encrypt(nonce, secret.encode(), endpoint_id.bytes)

    def open(self, endpoint_id: UUID, sealed: bytes) -> str:
        try:
            return AESGCM(self._key).decrypt(sealed[:12], sealed[12:], endpoint_id.bytes).decode()
        except InvalidTag as error:
            raise ValueError("a stored webhook secret cannot be read with this SECRET_KEY") from error


def new_secret() -> str:
    return SECRET_PREFIX + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")


class WebhookStore:
    def __init__(self, pool: Pool, box: SecretBox) -> None:
        self._pool = pool
        self._box = box

    # endpoints

    def create(self, owner_id: UUID | None, url: str, limit: int | None = None) -> tuple[dict[str, Any], str]:
        """Add an endpoint. With a limit, the count and the insert happen under the owner's lock, so parallel
        requests cannot pass it."""
        endpoint_id, secret = uuid4(), new_secret()
        with self._pool.connection() as conn, conn.transaction():
            if owner_id is not None and limit is not None:
                conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 3))", (str(owner_id),))
                have = conn.execute(
                    "SELECT count(*) AS n FROM webhook_endpoints WHERE owner_id = %s", (owner_id,)
                ).fetchone()
                assert have is not None
                if have["n"] >= limit:
                    raise EndpointLimit
            row = conn.execute(
                "INSERT INTO webhook_endpoints (id, owner_id, url, secret_enc) VALUES (%s,%s,%s,%s)"
                " RETURNING " + ENDPOINT_COLUMNS,
                (endpoint_id, owner_id, url, self._box.seal(endpoint_id, secret)),
            ).fetchone()
        assert row is not None
        return row, secret

    def count(self, owner_id: UUID) -> int:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT count(*) AS n FROM webhook_endpoints WHERE owner_id = %s", (owner_id,)
            ).fetchone()
        assert row is not None
        return int(row["n"])

    def list_for(self, owner_id: UUID) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            return conn.execute(
                f"SELECT {ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE owner_id = %s ORDER BY created_at, id",  # noqa: S608
                (owner_id,),
            ).fetchall()

    def get(self, owner_id: UUID, endpoint_id: UUID) -> dict[str, Any] | None:
        with self._pool.connection() as conn:
            return conn.execute(
                f"SELECT {ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE owner_id = %s AND id = %s",  # noqa: S608
                (owner_id, endpoint_id),
            ).fetchone()

    def delete(self, owner_id: UUID, endpoint_id: UUID) -> bool:
        with self._pool.connection() as conn:
            return (
                conn.execute(
                    "DELETE FROM webhook_endpoints WHERE owner_id = %s AND id = %s", (owner_id, endpoint_id)
                ).rowcount
                == 1
            )

    def disable_all(self, owner_id: UUID, reason: str) -> int:
        """Switch off every endpoint of an account until the owner confirms them again. Used when sign-ins are
        revoked, so a stolen token cannot leave a webhook behind that outlives the revocation."""
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE webhook_deliveries SET state = 'cancelled', last_error = 'endpoint switched off'"
                " WHERE state = 'pending' AND endpoint_id IN (SELECT id FROM webhook_endpoints WHERE owner_id = %s)",
                (owner_id,),
            )
            return conn.execute(
                "UPDATE webhook_endpoints SET enabled = false, disabled_at = now(), disabled_reason = %s"
                " WHERE owner_id = %s AND enabled",
                (reason, owner_id),
            ).rowcount

    def enable(self, owner_id: UUID, endpoint_id: UUID) -> bool:
        with self._pool.connection() as conn:
            return (
                conn.execute(
                    "UPDATE webhook_endpoints SET enabled = true, consecutive_failures = 0, disabled_at = NULL,"
                    " disabled_reason = NULL WHERE owner_id = %s AND id = %s",
                    (owner_id, endpoint_id),
                ).rowcount
                == 1
            )

    def deliveries(self, owner_id: UUID, endpoint_id: UUID, limit: int) -> list[dict[str, Any]] | None:
        if self.get(owner_id, endpoint_id) is None:
            return None
        with self._pool.connection() as conn:
            return conn.execute(
                "SELECT id, session_id, state, attempts, next_attempt_at, last_status, last_error, created_at,"
                " delivered_at FROM webhook_deliveries WHERE endpoint_id = %s ORDER BY created_at DESC, id LIMIT %s",
                (endpoint_id, limit),
            ).fetchall()

    def ensure_operator(self, url: str, secret: str) -> None:
        """The endpoint behind SESSION_WEBHOOK_URL: one row, always matching the environment."""
        with self._pool.connection() as conn, conn.transaction():
            row = conn.execute("SELECT id FROM webhook_endpoints WHERE owner_id IS NULL").fetchone()
            endpoint_id = row["id"] if row else uuid4()
            sealed = self._box.seal(endpoint_id, secret)
            if row:
                conn.execute(
                    "UPDATE webhook_endpoints SET url = %s, secret_enc = %s WHERE id = %s",
                    (url, sealed, endpoint_id),
                )
            else:
                conn.execute(
                    "INSERT INTO webhook_endpoints (id, owner_id, url, secret_enc) VALUES (%s, NULL, %s, %s)",
                    (endpoint_id, url, sealed),
                )

    def secret_of(self, endpoint_id: UUID, sealed: bytes) -> str:
        return self._box.open(endpoint_id, sealed)


ENDPOINT_COLUMNS = (
    "id, url, enabled, consecutive_failures, disabled_at, disabled_reason, last_success_at, last_failure_at,"
    " last_status, last_error, created_at"
)


def enqueue_hook(conn: psycopg.Connection[Row], session: PracticeSessionOut, owner_id: UUID) -> None:
    """Finish hook: queue one delivery per enabled endpoint of the owner and one for the operator endpoint."""
    conn.execute(
        "INSERT INTO webhook_deliveries (endpoint_id, session_id, payload)"
        " SELECT id, %s, %s FROM webhook_endpoints WHERE enabled AND (owner_id = %s OR owner_id IS NULL)"
        " ON CONFLICT (endpoint_id, session_id) DO NOTHING",
        (session.id, json.dumps(payload_for(session)), owner_id),
    )


@dataclass
class DispatchReport:
    delivered: int = 0
    retrying: int = 0
    failed: int = 0
    skipped: int = 0


class Dispatcher:
    def __init__(
        self,
        pool: Pool,
        box: SecretBox,
        *,
        allow_private: bool = False,
        resolver: Resolver = system_resolver,
        rng: random.Random | None = None,
        sender: Callable[..., SendResult] = post_json,
    ) -> None:
        self._pool = pool
        self._box = box
        self._allow_private = allow_private
        self._resolver = resolver
        self._rng = rng or random.Random()  # noqa: S311 (jitter, not security)
        self._send = sender

    def run_once(self, limit: int = BATCH) -> DispatchReport:
        """Claim a batch and send it on a small pool. Each send ends by its deadline, so the pool is never held."""
        report = DispatchReport()
        jobs = self._claim(limit)
        if not jobs:
            return report
        lock = threading.Lock()

        def send(job: dict[str, Any]) -> None:
            local = DispatchReport()
            self._deliver(job, local)
            with lock:
                report.delivered += local.delivered
                report.retrying += local.retrying
                report.failed += local.failed

        with ThreadPoolExecutor(max_workers=min(POOL, len(jobs)), thread_name_prefix="webhook") as pool:
            list(pool.map(send, jobs))
        return report

    def _claim(self, limit: int) -> list[dict[str, Any]]:
        """Due deliveries, at most PER_ACCOUNT for any one account in a batch, so one account's endpoints cannot use
        every sender. Claiming moves next_attempt_at forward, so another worker or a crash never double-sends."""
        with self._pool.connection() as conn, conn.transaction():
            return conn.execute(
                "WITH ranked AS (SELECT d.id, d.next_attempt_at, row_number() OVER (PARTITION BY coalesce(e.owner_id, e.id)"
                " ORDER BY d.next_attempt_at, d.id) AS rn FROM webhook_deliveries d"
                " JOIN webhook_endpoints e ON e.id = d.endpoint_id"
                " WHERE d.state = 'pending' AND d.next_attempt_at <= now() AND e.enabled),"
                " picked AS (SELECT id FROM ranked WHERE rn <= %s ORDER BY next_attempt_at, id LIMIT %s),"
                " locked AS (SELECT d.id FROM webhook_deliveries d WHERE d.id IN (SELECT id FROM picked)"
                " AND d.state = 'pending' AND d.next_attempt_at <= now() FOR UPDATE OF d SKIP LOCKED)"
                " UPDATE webhook_deliveries d SET next_attempt_at = now() + make_interval(secs => %s)"
                " FROM locked, webhook_endpoints e WHERE d.id = locked.id AND e.id = d.endpoint_id"
                " RETURNING d.id, d.endpoint_id, d.payload, d.attempts, e.url, e.secret_enc",
                (PER_ACCOUNT, limit, LEASE_SECONDS),
            ).fetchall()

    def _deliver(self, delivery: dict[str, Any], report: DispatchReport) -> None:
        endpoint_id: UUID = delivery["endpoint_id"]
        try:
            secret = self._box.open(endpoint_id, bytes(delivery["secret_enc"]))
        except ValueError:
            self._finish(delivery, SendResult(False, None, "secret unreadable"), report)
            return
        body = json.dumps(delivery["payload"], separators=(",", ":"), sort_keys=True).encode()
        timestamp = str(int(datetime.now(UTC).timestamp()))
        headers = {
            "Melophos-Event-Id": str(delivery["id"]),
            "Melophos-Event": "session.finished",
            "Melophos-Timestamp": timestamp,
            "Melophos-Signature": sign(secret, timestamp, body),
            "Melophos-Attempt": str(delivery["attempts"] + 1),
            "User-Agent": "melophos-webhooks/1",
        }
        result = self._send(
            delivery["url"], body, headers, allow_private=self._allow_private, resolver=self._resolver
        )
        self._finish(delivery, result, report)

    def _finish(self, delivery: dict[str, Any], result: SendResult, report: DispatchReport) -> None:
        attempts = delivery["attempts"] + 1
        with self._pool.connection() as conn, conn.transaction():
            if result.ok:
                conn.execute(
                    "UPDATE webhook_deliveries SET state = 'delivered', attempts = %s, last_status = %s,"
                    " last_error = NULL, delivered_at = now() WHERE id = %s",
                    (attempts, result.status, delivery["id"]),
                )
                conn.execute(
                    "UPDATE webhook_endpoints SET consecutive_failures = 0, last_success_at = now(),"
                    " last_status = %s, last_error = NULL WHERE id = %s",
                    (result.status, delivery["endpoint_id"]),
                )
                report.delivered += 1
                return
            if attempts >= MAX_ATTEMPTS:
                conn.execute(
                    "UPDATE webhook_deliveries SET state = 'failed', attempts = %s, last_status = %s, last_error = %s"
                    " WHERE id = %s",
                    (attempts, result.status, result.error, delivery["id"]),
                )
                report.failed += 1
            else:
                base = RETRY_DELAYS[attempts - 1]
                delay = base * (1 + self._rng.uniform(-JITTER, JITTER))
                conn.execute(
                    "UPDATE webhook_deliveries SET attempts = %s, last_status = %s, last_error = %s,"
                    " next_attempt_at = now() + make_interval(secs => %s) WHERE id = %s",
                    (attempts, result.status, result.error, delay, delivery["id"]),
                )
                report.retrying += 1
            row = conn.execute(
                "UPDATE webhook_endpoints SET consecutive_failures = consecutive_failures + 1, last_failure_at = now(),"
                " last_status = %s, last_error = %s WHERE id = %s RETURNING consecutive_failures",
                (result.status, result.error, delivery["endpoint_id"]),
            ).fetchone()
            if row and row["consecutive_failures"] >= DISABLE_AFTER:
                self._switch_off(conn, delivery["endpoint_id"])

    @staticmethod
    def _switch_off(conn: psycopg.Connection[Row], endpoint_id: UUID) -> None:
        conn.execute(
            "UPDATE webhook_endpoints SET enabled = false, disabled_at = now(), disabled_reason = %s WHERE id = %s",
            (f"switched off after {DISABLE_AFTER} failed attempts in a row", endpoint_id),
        )
        conn.execute(
            "UPDATE webhook_deliveries SET state = 'cancelled', last_error = 'endpoint switched off'"
            " WHERE endpoint_id = %s AND state = 'pending'",
            (endpoint_id,),
        )
        log.warning("webhook endpoint %s switched off after repeated failures", endpoint_id)
