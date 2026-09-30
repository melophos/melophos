from app.schemas import NoteEvent
from app.stats import key_heatmap, summarise


def events(*pairs):
    return [NoteEvent(t_ms=t, note=n, velocity=v) for t, n, v in pairs]


def test_empty_session():
    summary = summarise([])
    assert summary.notes_played == 0
    assert summary.most_played_note is None


def test_summary_counts_presses_not_releases():
    summary = summarise(events((0, 60, 100), (500, 60, 0), (1000, 62, 50), (60000, 62, 0)))
    assert summary.notes_played == 2
    assert summary.unique_notes == 2
    assert summary.duration_ms == 60000
    assert summary.mean_velocity == 75.0
    assert summary.notes_per_minute == 2.0


def test_heatmap():
    assert key_heatmap(events((0, 60, 90), (10, 60, 0), (20, 60, 90), (30, 64, 90))) == {60: 2, 64: 1}
