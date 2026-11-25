# Pins and power

Status: header and table compared by a host test. Nothing has been checked on a board.

## Pins

`include/melophos_config.h` holds the hub board's pins. They come from the board's module pin table, which is kept with the board design and is the source. A copy is in `test/data/hub-pins.md` and `test_pins` compares the header with it line for line. If the two disagree the board's table wins: update the copy and the header together.

| Signal | GPIO | Direction | Notes |
| --- | --- | --- | --- |
| LED_KEYS, LED_FRETS | 4, 5 | out | Through a 74HCT125 with its enables tied to ground. GPIO4 and GPIO5 have no pull inside the module at reset: the board's 10 k pull-downs hold the data lines low. The LED part's input high level is 0.65 x VDD |
| I2S_MCLK, BCLK, WS, DIN | 7, 15, 16, 17 | out, out, out, in | DIN is driven by the converter |
| MIDI_TX, MIDI_RX | 8, 18 | out, in | See below |
| HOST_EN | 9 | out, active high | The TPS2553 enable. Low at reset, so the keyboard port is off until the firmware turns it on |
| HOST_FAULT | 10 | in | The switch's fault output. High means no fault. The firmware reads it and cuts power on a fault |
| HOST_CC1, HOST_CC2 | 2, 6 | analogue in | |
| I2C_SDA, I2C_SCL | 11, 12 | | |
| SENSE_5V | 1 | analogue in | Half of the 5 V rail |
| STATUS_LED | 21 | out | Not used yet |
| SENSE_VIN | 13 | in, logic | See below |
| ENC_A, ENC_B, ENC_SW | 47, 48, 14 | in | The rotary encoder. Each has a 2.7 k pull-up on the contact to +3V3_MOD, 10 k in series to the pin and 10 nF on the pin and the switch reads low while pressed. **Awaits a board** |
| LED_AUX | 38 | out | The third LED output on connector J14 (the pin order of the keys and frets connectors), through the same level shifter and held low at reset by a 10 k. **Awaits a board** |
| BUZZER | 40 | out | Through a transistor from the 5 V rail, held off at reset by a 10 k. GPIO 40 is not driven during boot, so the buzzer stays silent at power-up. **Awaits a board** |
| J15 | 39, 41, 42 | none | The spare header: ground, 3.3 V and these three, spare pins (not JTAG: see below). Left untouched. **Awaits a board** |
| Console | 43, 44 | | UART0 through the CH340C bridge on its own connector |

GPIO 35, 36 and 37 are the module's PSRAM and are never driven (a test checks no signal uses them or the strapping pins). GPIO 19 and 20 are the host USB data pair and glitch at power-up, which is harmless there.

**The second issue of the schematic (22 November 2026, cd5c8dd8)** added the encoder, the third LED output, the buzzer and J15. The module's reset state of GPIO 14, 38, 39, 40, 41, 42, 47 and 48 has not been read from Espressif's data sheet, only the board's own pulls are known. So `setup()` puts the safe states in first, before anything that can take time: LED_AUX low, BUZZER low (off) and the three encoder pins as inputs. GPIO 39, 41 and 42 are left untouched unless a build defines `MELOPHOS_CLAIM_SPARE_PINS` (none does). The classic ESP32 bring-up board has none of these parts: its environment sets their pins to -1 and it drives the key strip alone.

**Three LED outputs, one ceiling.** The key, fret and aux strips are one frame to the output guard (keys, then frets, then aux: 180 + 150 + 150 lights, `kGuardLeds` 480). The current ceiling (2700 mA, 1200 mA while audio runs, the supply setting and the inlet rule) is a TOTAL over every light on every output, never a figure per strip. The flash limits count across all outputs together because the lights are seen together. Host tests light all three outputs at once and check the total stays under each ceiling and the strip limits hold across outputs. **Awaits a board.**

**The third output's length.** Two figures. The longest strip the hub supports on J14 is a hard maximum, `kAuxLedsMax` = `MAX_AUX_LEDS` = **150 lights** (a placeholder until the real figure is chosen). The length in use is a stored setting, default **60**, set with `aux length <n>` on serial, refused above the maximum and refused if the write to flash fails (it takes effect after a restart, because FastLED is told the length once). Data is sent only to the length in use. The guard always reserves the idle draw of the MAXIMUM, about 1 mA a light, whatever length is in use, so a strip of up to 150 lights can never put the total over the ceiling even when its extra lights receive no data. **A strip longer than the maximum is not supported.** The strip sends nothing back, so the firmware cannot detect one. What stands behind that case is the board's resettable fuse (4.62 A at 50 C) and the budget's margin: 4.62 A less the 4.463 A budget leaves 0.171 A, so about 170 extra lights idling at 1 mA each before the fuse is in play. Each extra light beyond that is not counted by the ceiling.

At every start `setup()` blanks every output at its MAXIMUM length first, before any storage is read and only then cuts the third output down to the length in use, so a strip that was longer on the last run holds no stale colours past the new length. The length is parsed strictly, like every numeric serial argument (`aux length`, `provision broker` and `provision api` ports and `provision supply`): digits only, the whole argument, range checked before any cast, so `abc`, `12abc`, `-1` and `65596` are refused with a message.

**The floor and the ceiling.** A lit light is never scaled to dark: it keeps level 1 of its strongest channel. The floor is part of the draw, so the guard settles the scale as the largest one at which the frame WITH the floor fits and does it before the per-light and strip rules run, so a steady frame stays steady (an earlier version put lights out afterwards, outside the flash rules and a steady frame flickered). On the hub board the idle draw is 480 mA (all 480 lights counted, the third output at its maximum) and each lit light at level 1 adds 20/255 mA, so all 390 lights that can be lit (the third output in use at 60) stay lit from a ceiling of **511 mA** up (518 mA if all 480 could be lit). The lowest ceiling the firmware sets is **512 mA** (the 2.5 A supply setting), so the floor always fits and the ceiling never puts a light out. Under 511 mA, which is never set, the ceiling would win and lights would go dark from the highest index first. A light that a rule holds stays as it was shown. If a hold carries brightness from a higher ceiling the guard releases it through the rules first (the held lights are lowered, still lit) and only then lowers the scale, so a steady frame does not dim when the ceiling falls. What the rules judged is what is shown, except under 511 mA (never set) and at a ceiling of 0, where the strip has no supply and every light goes dark at once (counted, not limited). A property test over random sequences of frames, ceilings, audio states and supply settings (`test_guard2` runs 40 seeds in each of two layouts and `test_guard3` runs 60 seeds or the number in `GUARD3_SEEDS`) checks that what leaves the guard never exceeds the ceiling in total, never exceeds 3 off-to-on or 3 large rises per light in a second and never exceeds 30 lights out or 2 large rises of the total in a second.

**The third issue of the schematic (23 November 2026, a9a7e016).** No GPIO or net name changed. Each encoder line (GPIO 14, 47, 48) has a 2.7 k pull-up on the contact, 10 k from the contact to the pin and 10 nF on the pin (about 1.19 mA through a closed contact at worst. A press can read as one for 60 us before `setup()`, which the debounce ignores). GPIO 3 (JTAG_SEL) is held low by R67. **The board has no JTAG as built.** The default JTAG source of the ESP32-S3 is its USB controller, whose pins the keyboard host port uses and GPIO 3 is ignored unless a one-time fuse is burnt. So GPIO 39, 41 and 42 are spare pins on J15 and GPIO 40 is not driven during boot, so the buzzer does not click at power-up. Debugging is by the UART bridge. This rests on one reading of Espressif's data sheet until a second confirms it. `MELOPHOS_JTAG` stays as a build flag only for a board that does have JTAG on GPIO 39 to 42 (a development board wired for it or a hub with the fuse burnt): such a build never touches GPIO 40. The rev A hub as built leaves it at 0. The budget is now 4.463 A. **Awaits a board.**

**The encoder** (`lib/encoder`, `src/encoder_esp.*`): a decoder for the two phases (full quadrature with detents: a count only when a whole cycle ends at rest, nothing on bounce or an illegal transition) and a debounced switch (20 ms) with a press (on release) and a long press (800 ms). The pins are read every millisecond by a small task. The events are queued and nothing reads them yet. Possible uses, a proposal for the owner to choose from: the LED brightness master, the lesson tempo, picking a practice mode or a profile. The long press for pairing mode or mute. **Awaits a board.**

**The buzzer** (`lib/buzzer`, `src/buzzer_esp.*`): OFF by default and silent unless a stored setting turns sound on (`sound on` on serial, cleared by a factory reset), because a sound nobody asked for in a child's bedroom is a fault. A sound lasts at most 250 ms, the next starts at least 150 ms after the last ended, the duty never goes above 30 percent and the pitch stays between 300 and 4000 Hz. It is never driven while a build claims the pin for JTAG. The buzzer adds 5 mA, so the budget is 4.463 A. Nothing asks it for a sound yet. Possible uses, a proposal: a metronome click in the rhythm mode, a short tick for a wrong note, a confirmation after pairing. **Awaits a board.**

**MIDI out.** GPIO 8 is held high through R43 at reset but may put a 60 microsecond low pulse on the MIDI output as the module powers up, which the receiver may read as a stray start bit (an estimate). `setup()` drives the pin high as its very first act. The firmware cannot act before the chip's own start-up code, so a pulse in that window is outside its control.

**Console.** The keyboard host takes the chip's only USB PHY, so the USB serial console cannot be used. The hub environments set `ARDUINO_USB_CDC_ON_BOOT=0` and the console is UART0. This awaits a board.

**The DC inlet.** The console's USB-C cannot power the +5V rail. It reaches only +5V_SYS and the or-ing diode passes just its reverse leakage back onto +5V. From the schematic, with the DC inlet only the rail is 4.69 to 5.25 V with the LEDs dark (4.33 V at full load), which is 2.34 to 2.63 V on SENSE_5V (GPIO 1, half the rail). With USB-C alone at 25 C it is at most 1.24 V on the rail, 0.62 V on the pin. The diode's leakage warm is not stated yet and the board is gaining a second sense point.

The rule (`lib/inlet`, tested):

- *Present* is latched from a reading of 4.4 V or more on the rail (2.2 V on the pin) taken at start-up with the LEDs dark, before the first frame.
- *Dropped* only when the rail reads under 3.0 V (1.5 V on the pin), so a loaded rail at 4.33 V (2.165 V on the pin) never reads as "inlet absent".
- *Regained* by a reading of 2.2 V or more on the pin while the LEDs are dark.
- **SENSE_VIN** (GPIO 13) is the board's final second sense point and is read as a **logic input**, not through the ADC: it sits on the second ADC unit, which cannot be used while Wi-Fi runs. The jack goes through a divider of 47 k over 68 k with a 10 k series resistor to the pin, so the pin sees 0.5913 of the jack: 2.66 V at 4.50 V, 2.81 V at 4.75 V, 2.96 V at 5.00 V and 3.10 V at 5.25 V. The rev A hub environments set `SENSE_VIN_FITTED=1`. Truth table: **low** means no inlet (a reversed plug also reads low and the board blocks it). **High** with the rail latched at 4.4 V or more means inlet present. **High** with the rail under 3.0 V means over-voltage lockout, reported on serial and by the status LED blinking at 2 Hz. **High** with the rail between the two changes nothing (a sag). Between 1.36 V and 4.48 V at the jack the logic level is undefined and SENSE_5V decides: a low reading with a rail of 4.4 V or more counts as present. A low reading with a loaded rail under that is absent because a good inlet reads high.

Without the inlet:

- **Audio** is refused and switched off if the inlet goes away.
- **The keyboard port** stays off: HOST_EN is held low and the host state machine never switches it on.
- **The LEDs** are held to a ceiling of 0 mA, so every frame is sent dark. The strip is on the +5V rail, which USB-C alone cannot raise above 1.24 V, so it has no supply and data sent into an unpowered strip would only back-feed it through its input. There is no lower non-zero figure that would be right.
- **What the hub shows instead:** the status LED (GPIO 21, on the 3.3 V supply that USB does power) blinks at 1 Hz, which is under the flash limit and serial says once a minute: "power: the DC inlet is not present, so the LED strip, the keyboard port and audio are off. Plug in the DC supply".

## Power

Every LED output stays dark for the first 0.5 s after power-on (`OutputGuard::kPowerOnHoldMs`). The simulation of the hub's inlet shows its 5 V switch can take up to 252 ms to turn fully on, and a load drawn before then makes it carry the LED current while only partly on. The hold is twice that.

The LED ceiling is 2700 mA on the board's 5 A supply, one constant, `kLedCurrentCeilingMa`. The budget: LED bars 2.70 A, the keyboard's USB port 1.184 A (the port switch's highest limit with R14 1 per cent low), the module and logic 0.55 A and audio 0.02 A, the buzzer 0.005 A and the encoder pull-ups 0.004 A make 4.463 A against a resettable fuse that holds 4.62 A at 50 C. `provision supply <mA>` lowers it for a smaller adapter (`rating x 0.91 - 1763`, so a 3 A adapter gives 967 mA). The rating takes effect at once: the hub gives the guard the new ceiling as soon as the command is accepted and no restart is needed. While audio runs a second ceiling applies, 1200 mA (the board's figure), with a coarse stepped backstop from SENSE_5V that can lower it to 900 or 600 mA. The reading is good to plus or minus 150 mV on the rail (the data sheet's 50 mV after calibration in the highest range, which is 100 mV on the rail and the 1 per cent divider), so the backstop acts only below 4.47 V and this is a quality measure and not a safety one. The lower always wins. See [practice-modes.md](practice-modes.md).

## The classic ESP32 bring-up board

It is a development kit with the strip on a bench supply, so it has its own pin set and its own power rule (`esp32-bringup` in `platformio.ini`, checked by `pio test -e native-bringup`). It uses no flash pin (GPIO 6 to 11) and not the console UART (GPIO 1 and 3), puts SENSE_5V on GPIO 34 (an ADC1 pin, which works with Wi-Fi), has no host port, audio clock or SENSE_VIN and counts the inlet as present because there is none to sense (`MELOPHOS_BENCH_SUPPLY`). On the hub board's pin set it would have read the inlet as absent, kept the strip dark and silenced the console, because GPIO 1 is UART0 TX there.

## Bring-up checklist for the second issue (awaits a board)

- Read the Arduino loop task's stack high-water mark (`uxTaskGetStackHighWaterMark(NULL)`) after a minute of lit frames with all three outputs and note the figure. The guard's working frames are members of the guard, not on the stack, but this is the figure that proves it.
- Read the module's reset state of GPIO 14, 38, 39, 40, 41, 42, 47 and 48 on a scope or a meter, with the strips and the buzzer unplugged and note whether the buzzer or the third strip twitched before `setup()` ran.
- Fit a strip of the maximum length on J14 and one shorter and check the supply current with all lights dark equals the idle figure above.
- Turn `sound on` and check the buzzer's longest sound and least gap with a scope, with the loop deliberately blocked (a `factory-reset` or an `update`).
- Check the ESP32 core in the installed platform still has the LEDC calls the buzzer uses (see src/README.md).
- The esp_timer and LEDC glue (`src/buzzer_esp.cpp`) and the encoder task are compile-only and unmeasured. Measure on a board: the longest sound with the loop deliberately blocked, the gap between sounds on a scope and that the timer task and the loop task never leave the pin half set.
- Run `aux length 60`, `aux length abc` and `aux length 151` and check the last two are refused with a message and the first is kept after a restart.
