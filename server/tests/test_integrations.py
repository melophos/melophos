from urllib.parse import parse_qs, urlparse

from app.integrations import spotify, wled


def test_spotify_url_requests_only_listening_scopes():
    url = spotify.authorise_url("client-123", "http://localhost:8000/callback")
    query = parse_qs(urlparse(url).query)
    assert query["client_id"] == ["client-123"]
    assert set(query["scope"][0].split()) == {"user-top-read", "user-read-recently-played"}


def test_spotify_disabled_without_settings(client, monkeypatch):
    monkeypatch.delenv("SPOTIFY_CLIENT_ID", raising=False)
    assert client.get("/api/v1/integrations/spotify/authorise").status_code == 503


def test_wled_same_pitch_class_same_colour():
    assert wled.note_to_hue(60) == wled.note_to_hue(72)
    assert wled.state_for_note(60, 127)["bri"] == 254
