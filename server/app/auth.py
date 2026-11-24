"""Who is calling and the label every route must carry.

Every route is public, device or account. The label is data (`x-melophos-access` in the OpenAPI document) and the
matching dependency does the check and tests/test_route_access.py walks the registered routes to prove the two
agree, so a route added without a label fails the build instead of shipping open.
"""

import ipaddress
from typing import Annotated, Any, Literal, cast

from fastapi import Depends, HTTPException, Request

from .accounts import Account, AccountStore, DeviceIdentity
from .security import ACCOUNT_TOKEN_PREFIX, DEVICE_SECRET_PREFIX, RateLimiter, token_digest

Access = Literal["public", "device", "account"]
ACCESS_KEY = "x-melophos-access"


def get_accounts(request: Request) -> AccountStore:
    return cast(AccountStore, request.app.state.accounts)


def get_limiter(request: Request) -> RateLimiter:
    return cast(RateLimiter, request.app.state.limiter)


def _bucket_address(text: str) -> str:
    """The key limits use. An IPv6 caller controls a whole /64, so every address in it counts as one caller."""
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        return text
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def _trusted_peer(peer: str, cidrs: list[str]) -> bool:
    try:
        address = ipaddress.ip_address(peer)
    except ValueError:
        return (
            True  # not an address at all (the test client), so there is no outside caller to protect against
        )
    return any(address in ipaddress.ip_network(c, strict=False) for c in cidrs if c)


def client_ip(request: Request) -> str:
    """The caller's address as limits key it. X-Forwarded-For is believed only for the configured number of
    proxies and only when the direct peer is a trusted proxy network, so a caller reaching the server directly
    cannot choose its own address."""
    settings = request.app.state.settings
    peer = request.client.host if request.client else "unknown"
    hops: int = settings.trusted_proxy_hops
    if hops > 0 and _trusted_peer(peer, settings.trusted_proxy_cidrs):
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(forwarded) >= hops:
            return _bucket_address(forwarded[-hops])
    return _bucket_address(peer)


def _unauthorised(scheme: str) -> HTTPException:
    return HTTPException(status_code=401, detail="sign in first", headers={"WWW-Authenticate": scheme})


def require_account(request: Request) -> Account:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.startswith(ACCOUNT_TOKEN_PREFIX) or len(token) > 100:
        raise _unauthorised("Bearer")
    account = get_accounts(request).account_for_token(token)
    if account is None:
        raise _unauthorised("Bearer")
    return account


def _device(request: Request) -> DeviceIdentity:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    device_id, _, secret = value.partition(":")
    if scheme.lower() != "device" or not secret.startswith(DEVICE_SECRET_PREFIX) or len(value) > 160:
        raise _unauthorised("Device")
    identity = get_accounts(request).device_for_credential(device_id, token_digest(secret))
    if identity is None:
        raise _unauthorised("Device")
    return identity


def require_device_any(request: Request) -> DeviceIdentity:
    """A device that holds a valid credential, paired or not. Only the pairing status route uses this."""
    return _device(request)


def require_device(request: Request) -> DeviceIdentity:
    """A paired device. An unpaired hub cannot send data, because nobody owns what it would send."""
    identity = _device(request)
    if identity.owner_id is None:
        raise HTTPException(status_code=403, detail="this hub is not paired to an account yet")
    return identity


DeviceAnyDep = Annotated[DeviceIdentity, Depends(require_device_any)]
AccountDep = Annotated[Account, Depends(require_account)]
DeviceDep = Annotated[DeviceIdentity, Depends(require_device)]
AccountsDep = Annotated[AccountStore, Depends(get_accounts)]
LimiterDep = Annotated[RateLimiter, Depends(get_limiter)]


def access(kind: Access, *, any_device: bool = False) -> dict[str, Any]:
    """Route options: `@router.get("/x", **access("account"))`."""
    extra = {"openapi_extra": {ACCESS_KEY: kind}}
    if kind == "account":
        return {**extra, "dependencies": [Depends(require_account)]}
    if kind == "device":
        return {**extra, "dependencies": [Depends(require_device_any if any_device else require_device)]}
    return extra
