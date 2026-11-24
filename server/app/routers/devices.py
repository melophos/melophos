from contextlib import suppress
from datetime import datetime
from typing import cast

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..accounts import PAIRING_MINUTES, AddressFull, TooManyDevices, TooManyPending
from ..auth import AccountDep, AccountsDep, DeviceAnyDep, DeviceDep, LimiterDep, access, client_ip
from ..broker import BrokerAdmin, BrokerError
from ..clock import server_time, sync_status
from ..security import (
    DEVICE_SECRET_PREFIX,
    broker_password,
    display_code,
    new_token,
    normalise_code,
    token_digest,
)

router = APIRouter(prefix="/api/v1", tags=["devices"])

START_WINDOW = 3600
START_IP_LIMIT = 20  # new pairing codes per address per hour
CLAIM_WINDOW = 600
CLAIM_ACCOUNT_LIMIT = 5  # wrong codes per account per window
CLAIM_IP_LIMIT = 20  # wrong codes per address per window


class PairingStart(BaseModel):
    device_id: str
    device_secret: str = Field(description="The hub's credential. Shown once and never stored in plain text.")
    code: str = Field(description="Shown on the hub. The owner types it into the Studio.")
    expires_at: datetime
    expires_in: int


class ClaimBody(BaseModel):
    code: str = Field(max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=60)


class DeviceOut(BaseModel):
    id: str
    name: str
    firmware: str | None
    hardware_rev: str | None
    last_seen_at: datetime | None
    paired_at: datetime | None


class DeviceSecretOut(BaseModel):
    device_id: str
    device_secret: str


class DeviceStatus(BaseModel):
    device_id: str
    paired: bool
    server_time: int = Field(
        default_factory=server_time,
        description="The server's clock now, as whole seconds since the Unix epoch in UTC. A hub reaches the server"
        " over TLS, so this is its trusted time source: it corrects its own clock when it differs by more than a few"
        " minutes and distrusts network time until the two agree. Unless server_time_synced is false",
    )
    server_time_synced: bool | None = Field(
        default=None,
        description="Whether the server knows its own clock is right. True: the server is the time authority. False:"
        " its clock has not been synchronised since it started (a power cut on a machine with no clock battery), so"
        " a hub holds and does not correct its clock from server_time yet. Null: the server cannot tell, which a hub"
        " treats as true",
    )
    last_boot: int | None = Field(
        default=None,
        description="The highest boot value the server accepted from this hub or null. A hub whose own counter is"
        " more than 1 000 above it is refused and can see that here and tell its owner",
    )
    claimed_by: str | None = Field(
        default=None,
        description="The account that claimed this hub with its address partly hidden, for the hub to show so its"
        " owner can see at once if someone else typed the code",
    )
    undo_until: datetime | None = Field(
        default=None, description="Until then the hub can undo the claim with DELETE /api/v1/device/claim"
    )


def broker_of(request: Request) -> BrokerAdmin:
    return cast(BrokerAdmin, request.app.state.broker)


@router.post("/pairing", status_code=status.HTTP_201_CREATED, **access("public"))
def start_pairing(request: Request, accounts: AccountsDep, limiter: LimiterDep) -> PairingStart:
    """A new hub asks for an identity and a code. Nothing in the answer reveals any other device."""
    if not limiter.hit(f"pairstart:ip:{client_ip(request)}", START_IP_LIMIT, START_WINDOW):
        raise HTTPException(
            status_code=429, detail="too many pairing requests", headers={"Retry-After": "3600"}
        )
    secret = new_token(DEVICE_SECRET_PREFIX)
    try:
        device_id, code, expires = accounts.start_pairing(token_digest(secret), client_ip(request))
    except AddressFull as error:
        raise HTTPException(
            status_code=429,
            detail="this network already has its codes waiting, use one or wait up to 10 minutes",
            headers={"Retry-After": "600"},
        ) from error
    except TooManyPending as error:
        raise HTTPException(
            status_code=503,
            detail="pairing is very busy, try again in a few minutes",
            headers={"Retry-After": "600"},
        ) from error
    # no broker login yet. It is made once an account has claimed the hub, so someone with no account can never
    # hold a login that can publish to the broker
    return PairingStart(
        device_id=device_id,
        device_secret=secret,
        code=display_code(code),
        expires_at=expires,
        expires_in=PAIRING_MINUTES * 60,
    )


@router.get("/device", **access("device", any_device=True))
def device_status(identity: DeviceAnyDep, request: Request, accounts: AccountsDep) -> DeviceStatus:
    """The hub polls this after showing its code and sees `paired: true` once the owner has typed it.

    The first answer after the claim also creates the hub's broker login, using the secret the hub just sent, so the
    broker never holds a login for a hub nobody owns. `paired: true` means the broker login is ready.
    """
    if identity.owner_id is None:
        return DeviceStatus(
            device_id=identity.id,
            paired=False,
            last_boot=accounts.last_boot(identity.id),
            server_time_synced=sync_status(request.app.state.settings.clock_sync),
        )
    if not accounts.broker_ready(identity.id):
        secret = request.headers.get("authorization", "").partition(":")[2]
        try:
            broker_of(request).create_device(identity.id, broker_password(secret))
        except BrokerError as error:
            raise HTTPException(status_code=503, detail="the message broker is not available") from error
        accounts.mark_broker_ready(identity.id)
    who = accounts.claimant(identity.id)
    return DeviceStatus(
        device_id=identity.id,
        paired=True,
        claimed_by=who[0],
        undo_until=who[1],
        last_boot=accounts.last_boot(identity.id),
        server_time_synced=sync_status(request.app.state.settings.clock_sync),
    )


@router.delete("/device/claim", status_code=status.HTTP_204_NO_CONTENT, **access("device"))
def undo_claim(device: DeviceDep, request: Request, accounts: AccountsDep) -> Response:
    """The hub undoes a claim it did not expect, within 15 minutes of it. The hub is removed with whatever it
    stored and its login ends, so it can pair again and show a new code. Anyone who reads a code off a screen can
    claim a hub in the minutes it is shown and this is how the real owner takes it back."""
    if not accounts.undo_claim(device.id):
        raise HTTPException(status_code=403, detail="a claim can only be undone in the first 15 minutes")
    with suppress(BrokerError):
        broker_of(request).delete_device(device.id)
    return Response(status_code=204)


@router.post("/devices/pair", **access("account"))
def claim_device(
    body: ClaimBody, request: Request, account: AccountDep, accounts: AccountsDep, limiter: LimiterDep
) -> DeviceOut:
    # a place in both windows is taken before the code is looked at, under a lock, so forty parallel guesses are
    # judged one after another and only the budget's worth are ever evaluated. A right code gives the places back
    first = limiter.reserve(f"claim:acct:{account.id}", CLAIM_ACCOUNT_LIMIT, CLAIM_WINDOW)
    second = (
        limiter.reserve(f"claim:ip:{client_ip(request)}", CLAIM_IP_LIMIT, CLAIM_WINDOW) if first else None
    )
    if first is None or second is None:
        limiter.release(first)
        raise HTTPException(
            status_code=429, detail="too many wrong codes, wait and try again", headers={"Retry-After": "600"}
        )
    code = normalise_code(body.code)
    device_id = None
    if code is not None:
        try:
            device_id = accounts.claim(account.id, code, body.name)
        except TooManyDevices as error:
            limiter.release(first, second)
            raise HTTPException(
                status_code=409, detail="this account has the most devices it can hold"
            ) from error
    if device_id is None:
        raise HTTPException(status_code=404, detail="that code is wrong or has expired")
    limiter.release(first, second)
    device = accounts.get_device(account.id, device_id)
    assert device is not None
    return DeviceOut(**device)  # type: ignore[arg-type]


@router.get("/devices", **access("account"))
def list_devices(account: AccountDep, accounts: AccountsDep) -> list[DeviceOut]:
    return [DeviceOut(**d) for d in accounts.list_devices(account.id)]  # type: ignore[arg-type]


@router.get("/devices/{device_id}", **access("account"))
def get_device(device_id: str, account: AccountDep, accounts: AccountsDep) -> DeviceOut:
    device = accounts.get_device(account.id, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="device not found")
    return DeviceOut(**device)  # type: ignore[arg-type]


@router.post("/devices/{device_id}/credential", **access("account"))
def rotate_credential(
    device_id: str, request: Request, account: AccountDep, accounts: AccountsDep
) -> DeviceSecretOut:
    """Issue a new credential and end the old one. Use it when a hub is lost or its secret may have leaked."""
    if accounts.get_device(account.id, device_id) is None:
        raise HTTPException(status_code=404, detail="device not found")
    secret = new_token(DEVICE_SECRET_PREFIX)
    if accounts.broker_ready(device_id):
        try:
            broker_of(request).set_secret(device_id, broker_password(secret))
        except BrokerError as error:
            raise HTTPException(status_code=503, detail="the message broker is not available") from error
    # a hub whose login was never made gets it from its next status call with the new secret
    accounts.set_credential(account.id, device_id, token_digest(secret))
    return DeviceSecretOut(device_id=device_id, device_secret=secret)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def remove_device(device_id: str, request: Request, account: AccountDep, accounts: AccountsDep) -> Response:
    """Unpair a hub. Its credential stops working and its sessions are deleted with it."""
    if not accounts.delete_device(account.id, device_id):
        raise HTTPException(status_code=404, detail="device not found")
    # the device row is gone, so the server ignores its traffic even if the broker login lingers
    with suppress(BrokerError):
        broker_of(request).delete_device(device_id)
    return Response(status_code=204)
