from .fuzz_midi import fuzz


def test_a_short_fuzz_run_finds_no_crash_hang_or_memory_blow_up():
    report = fuzz(4.0, seed=42)
    assert report["cases"] > 500
    assert report["parsed"] > 0 and report["refused"] > 0
