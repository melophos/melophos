"""WLED room lights through the JSON API, so any stock WLED controller works."""


def note_to_hue(note: int) -> int:
    return round((note % 12) / 12 * 65535)


def state_for_note(note: int, velocity: int) -> dict[str, object]:
    brightness = max(8, min(255, velocity * 2))
    hue = note_to_hue(note)
    return {"on": True, "bri": brightness, "seg": [{"col": [list(_hue_to_rgb(hue))]}]}


def _hue_to_rgb(hue16: int) -> tuple[int, int, int]:
    h = hue16 / 65535 * 6
    sector = int(h) % 6
    frac = h - int(h)
    rising, falling = round(255 * frac), round(255 * (1 - frac))
    return [
        (255, rising, 0),
        (falling, 255, 0),
        (0, 255, rising),
        (0, falling, 255),
        (rising, 0, 255),
        (255, 0, falling),
    ][sector]
