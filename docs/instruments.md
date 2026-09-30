# Instruments

Every instrument is described by a profile in [`profiles/`](../profiles/). The profile says which notes the instrument plays and how its lights are laid out. The format is documented in [profiles/README.md](../profiles/README.md).

## Keyboards

### Octave LED bars (recommended)

Each octave bar carries 12 LEDs placed at real key spacing, with black-key LEDs set back to line up with the black keys. Bars snap together and short end bars cover the keys left over at each end, so any keyboard from 25 to 88 keys is covered. The profile uses `"layout": "per-key"` and every key gets exactly one LED.

### LED strip

A plain WS2812B strip also works. The profile uses `"layout": "strip"` with the strip's `density_per_m`. The hub computes each key's centre from the white-key width to pick the nearest LED. At 144 LEDs per metre an 88-key keyboard needs 176 LEDs, which is a 2 m strip cut after the 176th LED.

### Lining the lights up

1. Set `offset` so the lowest key's LED is lit when that key is pressed.
2. Play the highest key. If its light is off by one or two LEDs, adjust `white_key_mm` in steps of 0.1 mm until both ends line up.
3. If the lights run the wrong way, set `reversed` to `true`.

> [!TIP]
> Most full-size keyboards have a white key pitch between 23.3 mm and 23.6 mm. Measure across seven white keys (one octave) and divide by seven for the most accurate value.

## Guitars

A fretboard profile lists the open-string notes and the number of frets. The fret bar is a grid with one LED per string per fret. `serpentine` is `true` when alternate strings run in opposite directions, which is how most flexible grids are wired.

A note appears at several places on a guitar neck. Guided songs carry the intended string and fret; free play lights every position of the played note dimly and the most likely one brightly.

## Adding an instrument

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [profiles/README.md](../profiles/README.md). A new profile is the easiest first contribution.
