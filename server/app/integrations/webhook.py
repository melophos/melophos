"""Session webhook, so external dashboards get practice data without polling."""

from ..schemas import PracticeSessionOut


def payload_for(session: PracticeSessionOut) -> dict[str, object]:
    return {
        "event": "session.finished",
        "session_id": str(session.id),
        "device_id": session.device_id,
        "profile_id": session.profile_id,
        "started_at": session.started_at.isoformat(),
        "summary": session.summary.model_dump(),
    }
