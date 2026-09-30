# Octave LED bar

A strip of 12 LEDs placed at real key positions, so every key on a keyboard gets exactly one LED with no drift along the keybed.

## Rev A requirements

- 12 WS2812B-2020 LEDs: 7 on the white-key line, 5 set back on the black-key line
- Pitch from a standard white key width of 23.5 mm, so one bar spans 164.5 mm
- Data in, data out and 5 V power on edge connectors so bars daisy-chain end to end
- A short end bar for the keys left over at each end of 61, 76 and 88 key instruments
- Mounting holes that match the aluminium rail in [enclosures/](../enclosures/)

The LED order along the bar is C, C sharp, D and so on up to B, matching the `per-key` layout in [profiles/](https://github.com/melophos/profiles).
