# USB-MIDI keyboards

The ESP32-S3 acts as a USB host, powers the keyboard and pushes its notes onto the note bus with the `usb_midi` source. Status: builds for the board, byte handling and state machine tested on the host, awaits a board.

## What is tested on the host

| Part | Tested |
| --- | --- |
| USB-MIDI event packets | Note on and note off, velocity 0, program change and sysex ignored, a data byte with bit 7 set refused, a code index that disagrees with the status refused, a short tail dropped and counted |
| Byte stream parser shared with the MIDI jack | Running status, real-time bytes inside a message, truncated messages, stray data, sysex that never ends, a 5000 byte sysex dump, a stalled partial message, a flood of 100 000 notes |
| Power and enumeration state machine | Power on, enumerate, replug 20 times without a reset, a device that never answers, five failures then wait for an unplug, a device that is not MIDI, overcurrent latching after three, stale events, the millisecond counter wrapping |

Recovery without a reset is a VBUS cycle. On any detach or failed enumeration the hub drops VBUS for 500 ms (doubling to 8 s after a failure) and waits for a new device. A 3 s enumeration time-out ends a silent device. Overcurrent cuts VBUS at once and waits 10 s. Three in a row latch it off until `clearFault()`.

## The test keyboard

The Gear4music VISIONKEY-100 is the keyboard the tests are built around. Connected to a computer by one USB-C cable, it takes its power from the cable and presents a standard USB MIDI device: audio class with a MIDI streaming interface, so no driver is needed and the hub's USB host can read it. It reports the product name "USB MIDI", the manufacturer "Kalezo", vendor 0x2485 and product 0x4330, at full speed (12 Mb/s).

Its keys are velocity sensitive: a 90 second capture held 40 presses on channel 1 with velocities from 21 to 95. Releases arrive as note-on with velocity 0, the usual running form. The capture is in [`test/data/visionkey-100-capture.txt`](../test/data/visionkey-100-capture.txt) and the host tests replay it.

> [!NOTE]
> The first group of messages in the capture arrived in a single burst, including four releases whose presses never arrived. The first presses after the keyboard wakes may be held back or lost, which is worth checking on the hub.

## Pins

The power switch is a TPS2553 with an enable pin and an open-drain fault pin. The GPIOs in [`melophos_config.h`](../include/melophos_config.h) (10 and 11) are provisional until the rev A schematic is final. Check them first.

## Not tested: needs a board

The real USB host stack and the power switch are the parts no host test reaches.

1. Check the two GPIOs against the rev A schematic.
2. Plug a class-compliant keyboard and confirm that enumeration finishes and the serial log shows notes.
3. Check that `usb_midi` appears in the status inputs.
4. Unplug and replug 20 times and confirm no reset.
5. Plug a USB mouse and confirm the hub refuses it and recovers when it is removed.
6. Short VBUS through a low-value resistor and confirm that the switch reports a fault and that VBUS is cut.
7. Measure the keyboard's idle and peak current against the 1 A switch limit.
8. Try a keyboard that needs more than 500 mA and a hub in between.
9. Time a key press to the LED with a logic analyser and compare with the budget in [practice-modes.md](practice-modes.md).
10. Try keyboards with more than one MIDI cable or with a composite interface.
