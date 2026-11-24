# MELOPHOS hardware

KiCad designs for the MELOPHOS hub and its light bars.

> [!IMPORTANT]
> The boards are still in the works. We publish the finished designs here once the boards have been made and tested.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

| Folder | Board | Status |
| --- | --- | --- |
| [`hub/`](hub/) | The hub: ESP32-S3, USB-C power, USB host port, LED outputs, MIDI jacks, audio input | Rev A in design |
| [`keys-octave/`](keys-octave/) | Octave LED bar: 12 LEDs at real key spacing, daisy-chained | Rev A in design |
| [`frets/`](frets/) | Fret bar: one LED per string per fret for guitars | Planned for v3 |
| [`enclosures/`](enclosures/) | 3D-printable hub case and bar mounting rail | Planned |
| [`bom/`](bom/) | Bills of materials | Draft |

## Design tools

- KiCad 9 for schematics and layout
- FreeCAD or OpenSCAD for enclosures, exported to STEP and STL

> [!IMPORTANT]
> Commit the KiCad sources (`.kicad_pro`, `.kicad_sch`, `.kicad_pcb`) with every change, never only exported Gerbers. The hardware licence expects the files others can edit.

## Power budget

The power budget is being finalised with the boards. The firmware's current limits and the figures behind them are in [firmware/docs/pins-and-power.md](https://github.com/melophos/melophos/blob/main/firmware/docs/pins-and-power.md).

## Licence

CERN Open Hardware Licence Version 2, Strongly Reciprocal. See [LICENSE](LICENSE).
