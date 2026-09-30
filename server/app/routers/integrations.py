from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..integrations import spotify

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


@router.get("/spotify/authorise")
def spotify_authorise() -> dict[str, str]:
    settings = get_settings()
    if not settings.spotify_client_id:
        raise HTTPException(status_code=503, detail="Spotify is not configured on this server")
    return {"url": spotify.authorise_url(settings.spotify_client_id, settings.spotify_redirect_uri)}
