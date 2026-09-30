"""Spotify learn list. Listening metadata only, audio never comes from Spotify."""

from urllib.parse import urlencode

AUTHORISE_URL = "https://accounts.spotify.com/authorize"
SCOPES = ("user-top-read", "user-read-recently-played")


def authorise_url(client_id: str, redirect_uri: str, state: str = "") -> str:
    query = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": " ".join(SCOPES),
    }
    if state:
        query["state"] = state
    return f"{AUTHORISE_URL}?{urlencode(query)}"
