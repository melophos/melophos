from collections.abc import Iterator
from typing import Any

import httpx


class Client:
    """Talks to the MELOPHOS server. An account token reads data, a device credential stores sessions."""

    def __init__(
        self,
        base_url: str,
        timeout: float = 10.0,
        token: str | None = None,
        device_id: str | None = None,
        device_secret: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"), timeout=timeout, follow_redirects=False, transport=transport
        )
        self.token = token
        self.device_id = device_id
        self.device_secret = device_secret

    def _account(self) -> dict[str, str]:
        if not self.token:
            raise RuntimeError("sign in first: this call needs an account token")
        return {"Authorization": f"Bearer {self.token}"}

    def _device(self) -> dict[str, str]:
        if not (self.device_id and self.device_secret):
            raise RuntimeError("pair the hub first: this call needs a device credential")
        return {"Authorization": f"Device {self.device_id}:{self.device_secret}"}

    def health(self) -> dict[str, Any]:
        return self._get("/health")

    def sign_up(self, email: str, password: str, display_name: str) -> dict[str, Any]:
        """Creates the account and signs in. Sign-up answers the same for a taken address,
        so signing in is what proves the account is yours."""
        body = {"email": email, "password": password, "display_name": display_name}
        self._post("/api/v1/auth/signup", body)
        return self.sign_in(email, password)

    def sign_in(self, email: str, password: str) -> dict[str, Any]:
        result = self._post("/api/v1/auth/signin", {"email": email, "password": password})
        self.token = result["token"]
        return result

    def start_pairing(self) -> dict[str, Any]:
        """A hub asks for an identity and a code. The device secret in the answer is shown once."""
        result = self._post("/api/v1/pairing")
        self.device_id, self.device_secret = result["device_id"], result["device_secret"]
        return result

    def device_status(self) -> dict[str, Any]:
        return self._get("/api/v1/device", self._device())

    def claim(self, code: str, name: str | None = None) -> dict[str, Any]:
        return self._post("/api/v1/devices/pair", {"code": code, "name": name}, self._account())

    def post_session(self, session: dict[str, Any]) -> dict[str, Any]:
        return self._post("/api/v1/sessions", session, self._device())

    def sessions(
        self, device_id: str | None = None, limit: int | None = None, cursor: str | None = None
    ) -> dict[str, Any]:
        """One page: `{"items": [...], "next_cursor": ...}`."""
        params = {k: v for k, v in {"device_id": device_id, "limit": limit, "cursor": cursor}.items() if v}
        return self._get("/api/v1/sessions", self._account(), params)

    def iter_sessions(self, device_id: str | None = None) -> Iterator[dict[str, Any]]:
        cursor: str | None = None
        while True:
            page = self.sessions(device_id=device_id, cursor=cursor)
            yield from page["items"]
            cursor = page["next_cursor"]
            if cursor is None:
                return

    def _get(
        self, path: str, headers: dict[str, str] | None = None, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        response = self._http.get(path, headers=headers, params=params)
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result

    def _post(
        self, path: str, body: dict[str, Any] | None = None, headers: dict[str, str] | None = None
    ) -> dict[str, Any]:
        response = self._http.post(path, json=body, headers=headers)
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result

    def close(self) -> None:
        self._http.close()
