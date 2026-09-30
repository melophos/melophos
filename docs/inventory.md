# Parts inventory

What is already on the bench for building the prototype and what still needs buying. Prices are rough UK estimates at the time of writing.

## On hand

| Part | Quantity | Used for |
| --- | --- | --- |
| Gear4music VISIONKEY-100, 88 keys | 1 | Test instrument: 88 keys, 1234 mm wide, powered over USB-C at 5 V. MIDI over USB is still to be confirmed |
| ESP32 development board (Wi-Fi and Bluetooth) | 3 | Early Bluetooth MIDI and LED bring-up. It has no USB host, so USB-MIDI waits for the ESP32-S3 |
| WS2812B strip, 60 LED/m, 1 m | 1 | First LED tests over part of the keyboard. Too sparse for one LED per key |
| GY-MAX4466 microphone amplifier | 2 | Early tests of audio note detection |
| SSD1306 OLED display, 0.96 inch | 4 | Hub status display during bring-up |
| LM2596 buck converter | 5 | 5 V rail from the 12 V adapter for bench testing at limited brightness |
| 12 V 2 A and 9 V power adapters | 2 | Bench power |
| 5.5 x 2.1 mm DC jacks | 6 | Power input |
| Fuse holders and 5 x 20 mm fuses | 1 kit | Protecting the LED supply |
| Component kit (resistors, LEDs, transistors) | 1 | 330 ohm data-line resistor and general use |
| 22 AWG stranded wire, heat shrink | 1 each | LED bar wiring |
| Breadboards and jumper wires | 2 sets | Prototyping |
| M3 nylon standoffs | 1 kit | Mounting boards |
| Raspberry Pi Pico 2W | 1 | Spare for experiments |
| Digital multimeter | 1 | Measuring rails and current draw |

## To buy

| Part | Quantity | Why | Rough cost |
| --- | --- | --- | --- |
| ESP32-S3-DevKitC-1 (N16R8) | 2 | The real hub chip: USB host for the keyboard, Bluetooth and Wi-Fi | £30 |
| WS2812B strip, 144 LED/m, 2 m | 1 | Full keyboard coverage before the octave bars exist | £20 |
| 74AHCT125 quad buffer (DIP) | 3 | 3.3 V to 5 V level shifting for the LED data lines | £4 |
| 5 V 6 A power supply with barrel plug | 1 | Enough headroom for a full bar plus the instrument | £15 |
| Electrolytic capacitor kit (including 1000 uF) | 1 | Smoothing the LED supply at the strip input | £8 |
| USB-C to USB-C data cable, short | 2 | One from hub to keyboard, one from hub to computer | £8 |
| 3.5 mm TRS jacks, 6N138 optocoupler, 1N4148 diodes | 1 set | MIDI in and out on the breadboard | £6 |
| PCM1808 I2S ADC module | 1 | Clean audio input for instrument and line level | £6 |
| Aluminium LED channel with diffuser, 1.5 m | 1 | Mounting and softening the lights behind the keys | £12 |
| Hub board and octave LED bars | 1 batch | Custom boards, see [hardware/](../hardware/) | Sponsored order, planned |
| Guitar | 1 | Testing the fret bar and guitar profiles in v3 | Later |

> [!TIP]
> The keyboard's USB port may only supply power. Before buying USB host parts in quantity, connect it to a computer and check whether it appears as a MIDI device (on macOS: Audio MIDI Setup, Window, Show MIDI Studio).
