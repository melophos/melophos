# MELOPHOS instrument profiles

An instrument profile describes which notes an instrument can play and how its lights are laid out. The hub firmware, the server, the Studio app and the simulator all read the same files, so a note always lands on the same LED everywhere.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Profiles

| File | Instrument | Light layout |
| --- | --- | --- |
| [`piano-88.json`](piano-88.json) | 88-key keyboard, A0 to C8 | One LED per key (octave bars) |
| [`piano-88-strip-144.json`](piano-88-strip-144.json) | 88-key keyboard, A0 to C8 | 144 LED/m strip |
| [`piano-76.json`](piano-76.json) | 76-key keyboard, E1 to G7 | One LED per key |
| [`piano-61.json`](piano-61.json) | 61-key keyboard, C2 to C7 | One LED per key |
| [`guitar-6-standard.json`](guitar-6-standard.json) | Six-string guitar, standard tuning, 22 frets | Grid, one LED per string and fret |

## Format

Every profile validates against [`schema.json`](schema.json) (JSON Schema 2020-12).

| Field | Applies to | Meaning |
| --- | --- | --- |
| `id` | all | Lowercase identifier, also the file name |
| `type` | all | `keyboard` or `fretboard` |
| `notes.lowest`, `notes.highest` | keyboard | MIDI note numbers of the lowest and highest keys (middle C is 60) |
| `geometry.white_key_mm` | keyboard | Width of one white key, used to place LEDs on a strip |
| `strings` | fretboard | Open-string MIDI notes, lowest string first |
| `frets` | fretboard | Number of frets |
| `leds.layout` | all | `per-key` (one LED per key), `strip` (fixed-density strip) or `grid` (strings by frets) |
| `leds.density_per_m` | strip | LEDs per metre of the strip |
| `leds.offset` | all | LEDs to skip before the first key or fret |
| `leds.reversed` | all | `true` when the data line enters from the high end |
| `leds.serpentine` | grid | `true` when alternate rows run in opposite directions |

## Adding a profile

1. Copy the closest existing profile and give it a new `id` and file name.
2. Check the key range against the instrument's manual. Most 88-key instruments run from MIDI 21 to 108.
3. Validate it:

   ```bash
   python -m jsonschema --instance your-profile.json schema.json
   ```

4. Open a pull request against `melophos/melophos`.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
