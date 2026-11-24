from fastapi import APIRouter, HTTPException, Request

from .. import __version__
from ..auth import access
from ..deps import PoolDep
from ..scoring import scorer_name

router = APIRouter(tags=["health"])


@router.get("/health", **access("public"))
def health(request: Request) -> dict[str, str]:
    """`scorer` says which scoring code is in use: `engine` (the Rust crate) or `stand-in`."""
    return {"status": "ok", "version": __version__, "scorer": scorer_name(request.app.state.scorer)}


@router.get("/ready", **access("public"))
def ready(request: Request, pool: PoolDep) -> dict[str, str]:
    """Answers 200 only when the database answers and, if MQTT is on, the ingest thread is alive."""
    ingest = getattr(request.app.state, "ingest", None)
    if ingest is not None and not ingest.healthy():
        raise HTTPException(status_code=503, detail="hub message ingest is not running")
    try:
        with pool.connection() as conn:
            conn.execute("SELECT 1")
    except Exception as error:
        raise HTTPException(status_code=503, detail="database unavailable") from error
    return {"status": "ready"}
