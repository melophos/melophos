import logging
from contextlib import suppress
from datetime import datetime
from hashlib import sha256
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..accounts import AccountStore
from ..auth import AccountDep, AccountsDep, LimiterDep, access, client_ip
from ..broker import BrokerError
from ..deps import PasswordsDep
from ..security import (
    ACCOUNT_TOKEN_PREFIX,
    GROUP_FULL,
    PASSWORD_MAX,
    new_token,
    normalise_email,
    password_problem,
    valid_email,
)
from ..store import MAX_EVENTS_PER_ACCOUNT

log = logging.getLogger("melophos.accounts")
WEBHOOKS_OFF = "sign-ins were revoked, confirm the endpoint with your password to turn it back on"
router = APIRouter(prefix="/api/v1/auth", tags=["accounts"])

SIGNIN_WINDOW = 15 * 60
SIGNIN_PAIR_LIMIT = 5  # wrong passwords per account and address in any window
SPRAY_ACCOUNTS = 20  # different accounts one address may try in any window, unless it already knows them
SIGNUP_WINDOW = 3600
SIGNUP_IP_LIMIT = 10


class SignUp(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=PASSWORD_MAX + 1)
    display_name: str = Field(min_length=1, max_length=80)


class SignIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=PASSWORD_MAX + 1)


class UserOut(BaseModel):
    id: UUID
    email: str
    display_name: str


class MeOut(UserOut):
    events_used: int = Field(description="Note events stored for this account")
    events_limit: int = Field(
        description="The most it may store. At the limit new sessions are refused (413 over HTTP) or skipped (MQTT) until some are deleted"
    )
    storage_full: bool


class TokenOut(BaseModel):
    token: str = Field(description="Send as `Authorization: Bearer <token>`. Shown once.")
    expires_at: datetime
    user: UserOut


class AuthSessionOut(BaseModel):
    id: UUID
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    user_agent: str | None
    current: bool


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=PASSWORD_MAX + 1)
    new_password: str = Field(max_length=PASSWORD_MAX + 1)


def too_many(seconds: int) -> HTTPException:
    return HTTPException(
        status_code=429, detail="too many attempts, wait and try again", headers={"Retry-After": str(seconds)}
    )


class SignUpAccepted(BaseModel):
    status: str = "accepted"
    message: str = (
        "Sign-up received. Now sign in with this address and password. If this address already had an account here,"
        " its password is unchanged, so sign in with the one you set before."
    )


@router.post("/signup", status_code=status.HTTP_202_ACCEPTED, **access("public"))
def sign_up(
    body: SignUp, request: Request, accounts: AccountsDep, limiter: LimiterDep, passwords: PasswordsDep
) -> SignUpAccepted:
    """The answer is the same whether or not the address already has an account, so sign-up cannot be used to
    find out who has one. This server sends no email, so nothing else can be said. The new person signs in next and
    an existing owner is not told. If mail is ever added, the existing owner gets one message here."""
    if not request.app.state.settings.allow_signup:
        raise HTTPException(status_code=403, detail="sign-ups are closed on this server")
    ip = client_ip(request)
    # every attempt counts here, a signup is not a failure and an open door must not become a free hash farm
    if not limiter.hit(f"signup:ip:{ip}", SIGNUP_IP_LIMIT, SIGNUP_WINDOW):
        raise too_many(SIGNUP_WINDOW)
    email = normalise_email(body.email)
    if not valid_email(email):
        raise HTTPException(status_code=422, detail="enter a valid email address")
    problem = password_problem(body.password, email)
    if problem:
        raise HTTPException(status_code=422, detail=f"password: {problem}")
    # one argon2 hash and one INSERT whichever way it goes, so time does not tell the two cases apart either
    created = accounts.create_user(email, body.display_name.strip(), passwords.hash(body.password))
    if not created:
        log.info("a sign-up used an address that already has an account")
    return SignUpAccepted()


def _open(accounts: AccountStore, request: Request, user_id: UUID, email: str, name: str) -> TokenOut:
    token = new_token(ACCOUNT_TOKEN_PREFIX)
    expires = accounts.open_session(user_id, token, request.headers.get("user-agent"))
    return TokenOut(token=token, expires_at=expires, user=UserOut(id=user_id, email=email, display_name=name))


@router.post("/signin", **access("public"))
def sign_in(
    body: SignIn, request: Request, accounts: AccountsDep, limiter: LimiterDep, passwords: PasswordsDep
) -> TokenOut:
    email = normalise_email(body.email)
    ip = client_ip(request)
    # one bucket per account and address together. It never counts anyone else's failures, so a stranger far away
    # cannot lock the owner out and other people on the same network are not blocked by each other's mistakes on
    # other accounts. The place is taken before the password is checked, under a lock, so parallel guesses cannot
    # all be judged against the same count. A right password hands it back
    user = accounts.user_by_email(email)
    known = user is not None and accounts.known_address(UUID(str(user["id"])), ip)
    group = f"signin:pair:{ip}:"
    pair = f"{group}{sha256(email.encode()).hexdigest()[:32]}"
    if known:
        # this address has signed in to this account before, so the spraying ceiling does not apply to it
        ticket = limiter.reserve(pair, SIGNIN_PAIR_LIMIT, SIGNIN_WINDOW)
    else:
        # an address may try SPRAY_ACCOUNTS different accounts in a window
        ticket = limiter.reserve_in_group(pair, SIGNIN_PAIR_LIMIT, SIGNIN_WINDOW, group, SPRAY_ACCOUNTS)
        if ticket == GROUP_FULL:
            # over the ceiling a further new account is not refused outright, because the right password must get
            # in (a household member's first sign-in can come from an address a stranger has been spraying).
            # It is slowed: one password check a second for the address, so spraying stays expensive
            if not limiter.hit(f"signin:slow:{ip}", 1, 1):
                raise HTTPException(
                    status_code=429, detail="busy, try again in a moment", headers={"Retry-After": "2"}
                )
            ticket = limiter.reserve(pair, SIGNIN_PAIR_LIMIT, SIGNIN_WINDOW)
    if ticket is None:
        raise too_many(SIGNIN_WINDOW)
    # one argon2 verification whether or not the address exists, so timing does not reveal accounts
    ok = passwords.verify(str(user["password_hash"]) if user else None, body.password, priority=known)
    if not ok or user is None:
        raise HTTPException(status_code=401, detail="email or password is wrong")
    limiter.release(ticket)
    accounts.remember_address(UUID(str(user["id"])), ip)
    if passwords.needs_rehash(str(user["password_hash"])):
        accounts.set_password(UUID(str(user["id"])), passwords.hash(body.password))
    return _open(accounts, request, UUID(str(user["id"])), str(user["email"]), str(user["display_name"]))


@router.get("/me", **access("account"))
def me(account: AccountDep, accounts: AccountsDep) -> MeOut:
    used = accounts.stored_events(account.id)
    return MeOut(
        id=account.id,
        email=account.email,
        display_name=account.display_name,
        events_used=used,
        events_limit=MAX_EVENTS_PER_ACCOUNT,
        storage_full=used >= MAX_EVENTS_PER_ACCOUNT,
    )


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def sign_out(account: AccountDep, accounts: AccountsDep) -> Response:
    accounts.revoke_session(account.id, account.auth_session_id)
    return Response(status_code=204)


@router.get("/sessions", **access("account"))
def list_sign_ins(account: AccountDep, accounts: AccountsDep) -> list[AuthSessionOut]:
    return [
        AuthSessionOut(
            id=r["id"],  # type: ignore[arg-type]
            created_at=r["created_at"],  # type: ignore[arg-type]
            last_used_at=r["last_used_at"],  # type: ignore[arg-type]
            expires_at=r["expires_at"],  # type: ignore[arg-type]
            user_agent=r["user_agent"],  # type: ignore[arg-type]
            current=r["id"] == account.auth_session_id,
        )
        for r in accounts.list_sessions(account.id)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def revoke_sign_in(session_id: UUID, account: AccountDep, accounts: AccountsDep) -> Response:
    if not accounts.revoke_session(account.id, session_id):
        raise HTTPException(status_code=404, detail="sign-in not found")
    return Response(status_code=204)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def change_password(
    body: PasswordChange,
    request: Request,
    account: AccountDep,
    accounts: AccountsDep,
    passwords: PasswordsDep,
    limiter: LimiterDep,
) -> Response:
    ticket = limiter.reserve(f"password:acct:{account.id}", 5, SIGNIN_WINDOW)
    if ticket is None:
        raise too_many(SIGNIN_WINDOW)
    user = accounts.user_by_email(account.email)
    assert user is not None
    if not passwords.verify(str(user["password_hash"]), body.current_password, priority=True):
        raise HTTPException(status_code=401, detail="the current password is wrong")
    limiter.release(ticket)
    problem = password_problem(body.new_password, account.email)
    if problem:
        raise HTTPException(status_code=422, detail=f"password: {problem}")
    accounts.set_password(account.id, passwords.hash(body.new_password))
    # a changed password ends every other sign-in, in case the old one was the problem
    accounts.revoke_all(account.id, keep=account.auth_session_id)
    request.app.state.webhooks.disable_all(account.id, WEBHOOKS_OFF)
    return Response(status_code=204)


@router.post("/signout-everywhere", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def sign_out_everywhere(account: AccountDep, accounts: AccountsDep, request: Request) -> Response:
    """End every sign-in of this account including this one and switch its webhook endpoints off until the
    owner confirms them again with the password."""
    accounts.revoke_all(account.id)
    request.app.state.webhooks.disable_all(account.id, WEBHOOKS_OFF)
    return Response(status_code=204)


class DeleteAccount(BaseModel):
    password: str = Field(max_length=PASSWORD_MAX + 1)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def delete_account(
    body: DeleteAccount,
    request: Request,
    account: AccountDep,
    accounts: AccountsDep,
    passwords: PasswordsDep,
    limiter: LimiterDep,
) -> Response:
    """Delete the account and everything it owns: devices, sessions, note events, songs, webhook endpoints and
    sign-ins. It cannot be undone, so it needs the password."""
    ticket = limiter.reserve(f"delete:acct:{account.id}", 5, SIGNIN_WINDOW)
    if ticket is None:
        raise too_many(SIGNIN_WINDOW)
    user = accounts.user_by_email(account.email)
    if user is None or not passwords.verify(str(user["password_hash"]), body.password, priority=True):
        raise HTTPException(status_code=401, detail="the password is wrong")
    device_ids = [str(d["id"]) for d in accounts.list_devices(account.id)]
    accounts.delete_account(account.id)
    for device_id in device_ids:
        with suppress(BrokerError):
            request.app.state.broker.delete_device(device_id)
    return Response(status_code=204)
