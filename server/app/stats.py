"""Session summaries from raw note events."""

from collections import Counter

from .schemas import NoteEvent, SessionSummary


def summarise(events: list[NoteEvent]) -> SessionSummary:
    presses = [e for e in events if e.velocity > 0]
    if not events:
        return SessionSummary(
            duration_ms=0,
            notes_played=0,
            unique_notes=0,
            most_played_note=None,
            mean_velocity=None,
            notes_per_minute=0.0,
        )

    # duration covers releases too, so a held final chord still counts
    duration_ms = max(e.t_ms for e in events) - min(e.t_ms for e in events)
    counts = Counter(e.note for e in presses)
    minutes = duration_ms / 60_000
    return SessionSummary(
        duration_ms=duration_ms,
        notes_played=len(presses),
        unique_notes=len(counts),
        most_played_note=counts.most_common(1)[0][0] if counts else None,
        mean_velocity=round(sum(e.velocity for e in presses) / len(presses), 1) if presses else None,
        notes_per_minute=round(len(presses) / minutes, 1) if minutes > 0 else 0.0,
    )


def key_heatmap(events: list[NoteEvent]) -> dict[int, int]:
    """Presses per MIDI note, the data behind the per-key heatmap."""
    return dict(Counter(e.note for e in events if e.velocity > 0))
