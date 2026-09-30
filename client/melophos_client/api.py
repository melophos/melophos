from typing import Any

import httpx


class Client:
    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def health(self) -> dict[str, Any]:
        return self._get("/health")

    def post_session(self, session: dict[str, Any]) -> dict[str, Any]:
        response = self._http.post("/api/v1/sessions", json=session)
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result

    def sessions(self, device_id: str | None = None) -> list[dict[str, Any]]:
        params = {"device_id": device_id} if device_id else None
        response = self._http.get("/api/v1/sessions", params=params)
        response.raise_for_status()
        result: list[dict[str, Any]] = response.json()
        return result

    def _get(self, path: str) -> dict[str, Any]:
        response = self._http.get(path)
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result

    def close(self) -> None:
        self._http.close()
