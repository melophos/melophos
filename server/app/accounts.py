"""Users, sign-in sessions, devices and pairing codes. Every statement takes the owner into account."""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from .db import Pool
from .security import code_digest, new_pairing_code, token_digest

AUTH_SESSION_DAYS = 30
PAIRING_MINUTES = 10
UNDO_MINUTES = 15
MAX_PENDING_PAIRINGS = 1000
# honest use needs one waiting code per household and a home network holds a handful at most. 1 000 waiting
# codes at once is far beyond that, so honest use never reaches the cap
PER_ADDRESS_PENDING = 5  # waiting codes one network may hold
# the last places are kept for networks the server already knows, so a household can pair during a flood
RESERVED_FOR_KNOWN = 100
PAIRING_LOCK = 727_002
MAX_DEVICES_PER_ACCOUNT = 20


@dataclass(frozen=True)
class Account:
    id: UUID
    email: str
    display_name: str
    auth_session_id: UUID


@dataclass(frozen=True)
class DeviceIdentity:
    id: str
    owner_id: UUID | None
    name: str


class AddressFull(Exception):
    pass


class TooManyPending(Exception):
    pass


class TooManyDevices(Exception):
    pass


class AccountStore:
    def __init__(self, pool: Pool, secret_key: str) -> None:
        self._pool = pool
        self._secret = secret_key

    # accounts

    def create_user(self, email: str, display_name: str, password_hash: str) -> bool:
        """Create the account unless the address is taken. The same single statement runs either way."""
        with self._pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO users (email, display_name, password_hash) VALUES (%s,%s,%s)"
                " ON CONFLICT (email) DO NOTHING RETURNING id",
                (email, display_name, password_hash),
            ).fetchone()
        return row is not None

    def user_by_email(self, email: str) -> dict[str, object] | None:
        with self._pool.connection() as conn:
            return conn.execute(
                "SELECT id, email, display_name, password_hash FROM users WHERE email = %s", (email,)
            ).fetchone()

    def set_password(self, user_id: UUID, password_hash: str) -> None:
        with self._pool.connection() as conn:
            conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))

    # sign-in sessions

    def open_session(self, user_id: UUID, token: str, user_agent: str | None) -> datetime:
        expires = datetime.now(UTC) + timedelta(days=AUTH_SESSION_DAYS)
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO auth_sessions (user_id, token_hash, expires_at, user_agent) VALUES (%s,%s,%s,%s)",
                (user_id, token_digest(token), expires, (user_agent or "")[:200] or None),
            )
        return expires

    def account_for_token(self, token: str) -> Account | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT s.id AS sid, s.last_used_at, u.id, u.email, u.display_name FROM auth_sessions s"
                " JOIN users u ON u.id = s.user_id"
                " WHERE s.token_hash = %s AND s.revoked_at IS NULL AND s.expires_at > now()",
                (token_digest(token),),
            ).fetchone()
            if row is None:
                return None
            last = row["last_used_at"]
            if last is None or datetime.now(UTC) - last > timedelta(minutes=10):
                conn.execute("UPDATE auth_sessions SET last_used_at = now() WHERE id = %s", (row["sid"],))
        return Account(row["id"], row["email"], row["display_name"], row["sid"])

    def list_sessions(self, user_id: UUID) -> list[dict[str, object]]:
        with self._pool.connection() as conn:
            return conn.execute(
                "SELECT id, created_at, last_used_at, expires_at, user_agent FROM auth_sessions"
                " WHERE user_id = %s AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()

    def revoke_session(self, user_id: UUID, session_id: UUID) -> bool:
        with self._pool.connection() as conn:
            cur = conn.execute(
                "UPDATE auth_sessions SET revoked_at = now() WHERE id = %s AND user_id = %s AND revoked_at IS NULL",
                (session_id, user_id),
            )
            return cur.rowcount == 1

    def revoke_all(self, user_id: UUID, keep: UUID | None = None) -> int:
        with self._pool.connection() as conn:
            cur = conn.execute(
                "UPDATE auth_sessions SET revoked_at = now()"
                " WHERE user_id = %s AND revoked_at IS NULL AND (%s::uuid IS NULL OR id <> %s::uuid)",
                (user_id, keep, keep),
            )
            return cur.rowcount

    # devices and pairing

    def start_pairing(self, secret_hash: bytes, requester: str) -> tuple[str, str, datetime]:
        """Create an unowned device and a pairing code for it. The caller keeps the plain secret.

        A waiting code is never taken away from the hub that holds it. It lives its ten minutes. Two caps decide
        whether a new one may be made: PER_ADDRESS_PENDING waiting codes for one network and MAX_PENDING_PAIRINGS in
        all. A request over either is refused, so a flood can delay new pairings for at most ten minutes and can
        never push out or take over a code that already exists.
        """
        with self._pool.connection() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (PAIRING_LOCK,))
            # entries whose code has run out are not waiting for anyone
            conn.execute(
                "DELETE FROM devices d WHERE d.owner_id IS NULL AND NOT EXISTS"
                " (SELECT 1 FROM pairing_codes p WHERE p.device_id = d.id AND p.expires_at > now())"
            )
            mine = conn.execute(
                "SELECT count(*) AS n FROM pairing_codes WHERE claimed_at IS NULL AND expires_at > now()"
                " AND requester = %s",
                (requester,),
            ).fetchone()
            total = conn.execute(
                "SELECT count(*) AS n FROM pairing_codes WHERE claimed_at IS NULL AND expires_at > now()"
            ).fetchone()
            assert mine is not None and total is not None
            if mine["n"] >= PER_ADDRESS_PENDING:
                raise AddressFull
            known = conn.execute(
                "SELECT 1 AS ok FROM known_addresses WHERE addr = %s LIMIT 1", (requester,)
            ).fetchone()
            if total["n"] >= MAX_PENDING_PAIRINGS - (0 if known else RESERVED_FOR_KNOWN):
                raise TooManyPending
            device_id = "hub-" + secrets.token_hex(5)
            code = new_pairing_code()
            expires = datetime.now(UTC) + timedelta(minutes=PAIRING_MINUTES)
            conn.execute(
                "INSERT INTO devices (id, name, credential_hash) VALUES (%s, %s, %s)",
                (device_id, "New hub", secret_hash),
            )
            conn.execute(
                "INSERT INTO pairing_codes (code_hash, device_id, expires_at, requester) VALUES (%s,%s,%s,%s)",
                (code_digest(code, self._secret), device_id, expires, requester),
            )
        return device_id, code, expires

    def claim(self, owner_id: UUID, code: str, name: str | None) -> str | None:
        """Bind the device behind a live code to an account. Single use: the row is consumed atomically."""
        with self._pool.connection() as conn, conn.transaction():
            # one claim at a time per account, so the limit cannot be passed by parallel requests
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 1))", (str(owner_id),))
            owned = conn.execute(
                "SELECT count(*) AS n FROM devices WHERE owner_id = %s", (owner_id,)
            ).fetchone()
            assert owned is not None
            if owned["n"] >= MAX_DEVICES_PER_ACCOUNT:
                raise TooManyDevices
            row = conn.execute(
                "UPDATE pairing_codes SET claimed_at = now() WHERE code_hash = %s AND claimed_at IS NULL"
                " AND expires_at > now() RETURNING device_id",
                (code_digest(code, self._secret),),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE devices SET owner_id = %s, paired_at = now(), name = COALESCE(%s, name)"
                " WHERE id = %s AND owner_id IS NULL",
                (owner_id, name, row["device_id"]),
            )
            return str(row["device_id"])

    def device_for_credential(self, device_id: str, secret_hash: bytes) -> DeviceIdentity | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT id, owner_id, name, credential_hash FROM devices WHERE id = %s", (device_id,)
            ).fetchone()
        stored = bytes(row["credential_hash"]) if row and row["credential_hash"] else b"\0" * 32
        if row is None or not secrets.compare_digest(stored, secret_hash):
            return None
        return DeviceIdentity(row["id"], row["owner_id"], row["name"])

    def touch_device(self, device_id: str) -> None:
        with self._pool.connection() as conn:
            conn.execute("UPDATE devices SET last_seen_at = now() WHERE id = %s", (device_id,))

    def list_devices(self, owner_id: UUID) -> list[dict[str, object]]:
        with self._pool.connection() as conn:
            return conn.execute(
                "SELECT id, name, firmware, hardware_rev, last_seen_at, paired_at FROM devices"
                " WHERE owner_id = %s ORDER BY created_at, id",
                (owner_id,),
            ).fetchall()

    def get_device(self, owner_id: UUID, device_id: str) -> dict[str, object] | None:
        with self._pool.connection() as conn:
            return conn.execute(
                "SELECT id, name, firmware, hardware_rev, last_seen_at, paired_at FROM devices"
                " WHERE owner_id = %s AND id = %s",
                (owner_id, device_id),
            ).fetchone()

    def set_credential(self, owner_id: UUID, device_id: str, secret_hash: bytes) -> bool:
        """A new secret also clears the replay state, so whatever counters a stolen secret set cannot outlive it."""
        with self._pool.connection() as conn, conn.transaction():
            cur = conn.execute(
                "UPDATE devices SET credential_hash = %s WHERE id = %s AND owner_id = %s",
                (secret_hash, device_id, owner_id),
            )
            if cur.rowcount == 1:
                conn.execute("DELETE FROM ingest_state WHERE device_id = %s", (device_id,))
            return cur.rowcount == 1

    def broker_ready(self, device_id: str) -> bool:
        with self._pool.connection() as conn:
            row = conn.execute("SELECT broker_ready FROM devices WHERE id = %s", (device_id,)).fetchone()
        return bool(row and row["broker_ready"])

    def mark_broker_ready(self, device_id: str, ready: bool = True) -> None:
        with self._pool.connection() as conn:
            conn.execute("UPDATE devices SET broker_ready = %s WHERE id = %s", (ready, device_id))

    def broker_logins_due(self) -> set[str]:
        """The device ids that should have a broker login: claimed hubs whose login was made."""
        with self._pool.connection() as conn:
            rows = conn.execute("SELECT id FROM devices WHERE broker_ready").fetchall()
        return {str(r["id"]) for r in rows}

    def delete_device(self, owner_id: UUID, device_id: str) -> bool:
        with self._pool.connection() as conn:
            cur = conn.execute("DELETE FROM devices WHERE id = %s AND owner_id = %s", (device_id, owner_id))
            return cur.rowcount == 1

    def claimant(self, device_id: str) -> tuple[str | None, datetime | None]:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT u.email, d.paired_at FROM devices d JOIN users u ON u.id = d.owner_id WHERE d.id = %s",
                (device_id,),
            ).fetchone()
        if row is None:
            return None, None
        name, _, domain = str(row["email"]).partition("@")
        hidden = f"{name[:1]}***@{domain}"
        return hidden, row["paired_at"] + timedelta(minutes=UNDO_MINUTES)

    def undo_claim(self, device_id: str) -> bool:
        with self._pool.connection() as conn:
            return (
                conn.execute(
                    "DELETE FROM devices WHERE id = %s AND owner_id IS NOT NULL"
                    " AND paired_at > now() - make_interval(mins => %s)",
                    (device_id, UNDO_MINUTES),
                ).rowcount
                == 1
            )

    def last_boot(self, device_id: str) -> int | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT max(boot) AS b FROM ingest_state WHERE device_id = %s", (device_id,)
            ).fetchone()
        return int(row["b"]) if row and row["b"] is not None else None

    def stored_events(self, user_id: UUID) -> int:
        with self._pool.connection() as conn:
            row = conn.execute("SELECT stored_events FROM users WHERE id = %s", (user_id,)).fetchone()
        return int(row["stored_events"]) if row else 0

    def known_address(self, user_id: UUID, addr: str) -> bool:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT 1 AS ok FROM known_addresses WHERE user_id = %s AND addr = %s", (user_id, addr)
            ).fetchone()
        return row is not None

    def remember_address(self, user_id: UUID, addr: str) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO known_addresses (user_id, addr) VALUES (%s, %s)"
                " ON CONFLICT (user_id, addr) DO UPDATE SET last_at = now()",
                (user_id, addr),
            )

    def delete_account(self, user_id: UUID) -> bool:
        """Everything hangs off the user row with ON DELETE CASCADE, so this one statement removes it all."""
        with self._pool.connection() as conn:
            return conn.execute("DELETE FROM users WHERE id = %s", (user_id,)).rowcount == 1

    def purge_expired(self) -> dict[str, int]:
        """Hourly tidy: sign-ins a week past expiry or a month past revocation and finished webhook deliveries older
        than 30 days. Nothing live is touched."""
        with self._pool.connection() as conn:
            sessions = conn.execute(
                "DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days'"
                " OR revoked_at < now() - interval '30 days'"
            ).rowcount
            conn.execute("DELETE FROM known_addresses WHERE last_at < now() - interval '90 days'")
            deliveries = conn.execute(
                "DELETE FROM webhook_deliveries WHERE state IN ('delivered', 'failed', 'cancelled')"
                " AND created_at < now() - interval '30 days'"
            ).rowcount
        return {"auth_sessions": sessions, "webhook_deliveries": deliveries}

    def purge_unclaimed(self) -> list[str]:
        """Remove devices whose pairing code ran out unclaimed and old counters. Returns the device ids."""
        with self._pool.connection() as conn:
            rows = conn.execute(
                "DELETE FROM devices d WHERE d.owner_id IS NULL AND d.created_at < now() - interval '1 hour'"
                " AND NOT EXISTS (SELECT 1 FROM pairing_codes p WHERE p.device_id = d.id AND p.expires_at > now())"
                " RETURNING d.id"
            ).fetchall()
        return [str(r["id"]) for r in rows]
