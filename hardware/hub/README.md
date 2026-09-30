# Hub board

The hub reads notes from the instrument, drives the light bars and talks to the server.

## Rev A requirements

- ESP32-S3-WROOM-1 module (16 MB flash, 8 MB PSRAM) with its antenna clear of copper
- USB-C in for 5 V power and programming
- USB-C host port that powers the instrument through a current-limited switch (1 A)
- Two level-shifted LED outputs (keys and frets) on locking connectors, each with a series resistor
- MIDI in through an optocoupler and MIDI out through a buffer, on 3.5 mm TRS type A jacks
- Instrument and line input into an I2S ADC
- Boot and reset buttons, a status LED and a header for an optional display
- Bulk capacitance and a resettable fuse on the LED supply

> [!WARNING]
> The USB host port supplies power to the instrument. The power switch must limit current and report faults. Without it, a short in a USB cable could brown out the whole hub.

## Files

KiCad sources land here with rev A. The draft bill of materials is [bom/hub-rev-a.csv](../bom/hub-rev-a.csv).
