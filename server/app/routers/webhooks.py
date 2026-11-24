from datetime import datetime
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from ..accounts import Account, AccountStore
from ..auth import AccountDep, AccountsDep, LimiterDep, access
from ..deps import PasswordsDep
from ..outbound import UnsafeDestination, check_url
from ..security import PasswordService, RateLimiter
from ..webhooks import MAX_ENDPOINTS_PER_ACCOUNT, EndpointLimit, WebhookStore

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])

CREATE_LIMIT = 10  # new endpoints per account per hour


class Confirm(BaseModel):
    password: str = Field(
        max_length=128,
        description="The account password, so a stolen sign-in token alone cannot add or revive an endpoint",
    )


class EndpointIn(Confirm):
    url: str = Field(
        max_length=2048, description="An https:// address that will receive each finished session"
    )


class EndpointOut(BaseModel):
    id: UUID
    url: str
    enabled: bool
    consecutive_failures: int
    disabled_at: datetime | None
    disabled_reason: str | None = Field(description="Why the endpoint was switched off, if it was")
    last_success_at: datetime | None
    last_failure_at: datetime | None
    last_status: int | None
    last_error: str | None
    created_at: datetime


class EndpointCreated(EndpointOut):
    secret: str = Field(description="The signing secret. Shown once, so store it now.")


class DeliveryOut(BaseModel):
    id: UUID
    session_id: UUID
    state: str
    attempts: int
    next_attempt_at: datetime
    last_status: int | None
    last_error: str | None
    created_at: datetime
    delivered_at: datetime | None


def confirm_password(
    accounts: AccountStore, passwords: PasswordService, limiter: RateLimiter, account: Account, password: str
) -> None:
    """Check the account password again for an action a stolen token must not be enough for. Wrong tries are limited."""
    ticket = limiter.reserve(f"confirm:acct:{account.id}", 5, 900)
    if ticket is None:
        raise HTTPException(
            status_code=429, detail="too many wrong passwords", headers={"Retry-After": "900"}
        )
    user = accounts.user_by_email(account.email)
    if user is None or not passwords.verify(str(user["password_hash"]), password, priority=True):
        raise HTTPException(status_code=401, detail="the password is wrong")
    limiter.release(ticket)


def webhooks_of(request: Request) -> WebhookStore:
    return cast(WebhookStore, request.app.state.webhooks)


def checked(request: Request, url: str) -> str:
    try:
        check_url(
            url,
            allow_private=request.app.state.settings.webhook_allow_private,
            resolver=request.app.state.resolver,
        )
    except UnsafeDestination as error:
        raise HTTPException(status_code=422, detail=f"url: {error}") from error
    return url


@router.post("", status_code=status.HTTP_201_CREATED, **access("account"))
def create_endpoint(
    body: EndpointIn,
    request: Request,
    account: AccountDep,
    limiter: LimiterDep,
    accounts: AccountsDep,
    passwords: PasswordsDep,
) -> EndpointCreated:
    store = webhooks_of(request)
    confirm_password(accounts, passwords, limiter, account, body.password)
    if not limiter.hit(f"webhook-create:{account.id}", CREATE_LIMIT, 3600):
        raise HTTPException(
            status_code=429, detail="too many endpoints created", headers={"Retry-After": "3600"}
        )
    try:
        row, secret = store.create(account.id, checked(request, body.url), MAX_ENDPOINTS_PER_ACCOUNT)
    except EndpointLimit as error:
        raise HTTPException(
            status_code=409, detail=f"an account can have {MAX_ENDPOINTS_PER_ACCOUNT} endpoints"
        ) from error
    return EndpointCreated(**row, secret=secret)


@router.get("", **access("account"))
def list_endpoints(request: Request, account: AccountDep) -> list[EndpointOut]:
    return [EndpointOut(**r) for r in webhooks_of(request).list_for(account.id)]


@router.get("/{endpoint_id}", **access("account"))
def get_endpoint(endpoint_id: UUID, request: Request, account: AccountDep) -> EndpointOut:
    row = webhooks_of(request).get(account.id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail="endpoint not found")
    return EndpointOut(**row)


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def delete_endpoint(endpoint_id: UUID, request: Request, account: AccountDep) -> Response:
    if not webhooks_of(request).delete(account.id, endpoint_id):
        raise HTTPException(status_code=404, detail="endpoint not found")
    return Response(status_code=204)


@router.post("/{endpoint_id}/enable", **access("account"))
def enable_endpoint(
    endpoint_id: UUID,
    body: Confirm,
    request: Request,
    account: AccountDep,
    limiter: LimiterDep,
    accounts: AccountsDep,
    passwords: PasswordsDep,
) -> EndpointOut:
    """Switch an endpoint back on after fixing the receiver or after sign-ins were revoked. Needs the password.
    The address is checked again first."""
    store = webhooks_of(request)
    confirm_password(accounts, passwords, limiter, account, body.password)
    row = store.get(account.id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail="endpoint not found")
    checked(request, str(row["url"]))
    store.enable(account.id, endpoint_id)
    fresh: dict[str, Any] | None = store.get(account.id, endpoint_id)
    assert fresh is not None
    return EndpointOut(**fresh)


@router.get("/{endpoint_id}/deliveries", **access("account"))
def endpoint_deliveries(
    endpoint_id: UUID,
    request: Request,
    account: AccountDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[DeliveryOut]:
    rows = webhooks_of(request).deliveries(account.id, endpoint_id, limit)
    if rows is None:
        raise HTTPException(status_code=404, detail="endpoint not found")
    return [DeliveryOut(**r) for r in rows]
