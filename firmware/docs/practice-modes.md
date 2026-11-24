# Practice modes and lights

Melody, Rhythm and Listen, with lights that never depend on colour alone. Status: builds for the board, tested on the host, awaits a board.

## Modes

| Mode | What it does |
| --- | --- |
| Melody | Lights the next note and waits for it for as long as it takes. A chord can be played in any order |
| Rhythm | Holds a tempo from 30 to 240 beats a minute after a count-in of up to 8 beats. Each note must land inside a window of 50 to 500 ms. It scores hits, early, late, missed and wrong |
| Listen | Plays the guide by itself so the player watches and listens. Notes the player adds are echoed and never scored |
| Off | Free play: only the keys pressed light |

A lesson is up to 512 steps of up to 4 notes each. A lesson from outside is checked before use: note range, step count, time order.

## What each light means

Every meaning has a colour and at least one other signal. The other signals are what a person who cannot tell colours apart relies on.

| Meaning | Colour (RGB at full) | Brightness | Pattern | Ends |
| --- | --- | --- | --- | --- |
| Guide, right hand and the next note | Amber (255, 150, 0) | 100 percent | Steady | The light goes out when the note is played |
| Guide, left hand | Blue (0, 110, 255) | 70 percent | Steady | The light goes out when the note is played |
| Played, in free play and Listen | Amber (255, 150, 0) | 55 percent | Steady while held | At key release |
| Upcoming | The hand's colour | 20 to 40 percent | 1 Hz pulse or steady at 30 percent with reduced motion | When it becomes the guide |
| Wrong | Rose-magenta (255, 0, 160) | 100 percent | Two flashes at 2 Hz or steady for 800 ms with reduced motion | By itself after 750 or 800 ms |

These are the Studio's light language (`studio/src/styles/lights.json`). Pure red is not used for a wrong note because it falls close to amber under the commonest colour vision difference. A right note puts its light out and nothing replaces it. A lesson marks the left-hand notes of a step with `leftMask`. On the bar the hand is told by colour and by brightness (the left hand is dimmer). The letter R or L belongs to the Studio's screen. Someone who cannot see colour and looks only at the bar can tell the hands apart by brightness but not by shape, which an LED cannot have.

Position is a signal as well. A wrong light is on the key that was pressed and never on the guide key. In Rhythm mode the approach is a dot that starts up to three keys below the target and hops once every 500 ms, so a player can see the beat arrive. With reduced motion the dot is replaced by the steady upcoming light.

A monochrome setting turns every role white. The test renders every role that way and checks that no two meanings give the same pattern over two seconds, in both motion settings.

## Flashing

The limits live in the LED sink (`lib/practice/outputguard.cpp`), the last step before the strip, so no source can get past them: not a keyboard, a lesson, a Bluetooth host or the insecure-mode glow. There are three rules. The first two apply to each light, the third to the strip as a whole.

1. **No LED goes from off to on more than 3 times in any one second.** When a light has used its 3 and the content asks for it to go out, the light stays lit instead. A light the content says is lit is never dark.
2. **No LED makes more than 3 large brightness rises in any one second and so no more than 3 falls.** "Large" follows the general flash definition: a change in relative luminance of 10 per cent of full white or more, where the darker state is under 0.80. Relative luminance is `0.2126 R + 0.7152 G + 0.0722 B` over full white. The strip is driven by PWM, so the light is proportional to the value sent and the value is already linear light: the weights are applied with no gamma step. The real light per channel differs from those weights (the blue die gives less light per mA) and that needs measuring on a board, so treat the 10 per cent as approximate. The drive is at most half scale (the master level is 128 of 255), so the darker state is always under 0.80 and the test always applies. A flash is a pair of opposing changes, so 3 rises and 3 falls a second is the limit. When a light would fall and leave no rise to spare, it is held at its brighter state, steady, until the oldest rise is a second old.
3. **The strip as a whole.** The general definition exempts a small area and so does this rule: **10 LEDs**. The reasoning, approximate until measured: the exemption covers a flash under a quarter of a 10 degree field of view. At the keyboard, about 0.4 m from the bar, 10 degrees is a disc 70 mm across (3850 mm2), a quarter of it is 960 mm2 and one key's lit diffuser is about 100 mm2, so about 10 keys. Changes inside the allowance pass under the per-light rule alone, so a pressed key or a chord lights at once. Beyond it, over ANY one-second window and summed across groups so that small groups taking turns cannot add up to a bar-wide flicker: at most 30 lights (3 x 10) go out in a second and the strip's total luminance makes at most 2 large rises (large here is 10 LEDs x 10 per cent). The total counts whatever each light's own swing is, so 180 lights each swinging a little together are limited as a whole. When either limit would be exceeded the lights that would fall stay as they were. A passage that really needs more than 30 lights to go out in a second (for instance 8 chords of 4 notes a second) will see the extra lights held on a little longer.

**What these limits do not do (the guard's stated residuals, measured at the strip in 1 ms steps).**

- Changes inside the 10 LED allowance are not limited at strip level. Ten separate groups of three lights taking turns gave 11 small flashes a second at the strip. Each light stays within its own limit and the group is under the allowance, so by the general definition's small-area exemption this is allowed. The exemption is only as good as the area figure below.
- A swing under the per-light threshold (10 per cent) on up to about ten lights at once passes. The strip rule counts a change of the strip's total, which starts at 10 LEDs times 10 per cent.
- A released key can stay lit for up to 500 ms while the strip's fall budget (30 lights a second) is spent. The light is held, steady and goes out as soon as the budget allows.
- The area allowance (10 LEDs) and the luminance model (the RGB weights, no gamma, the blue die's output) are not measured. They stay approximate until a board exists and someone measures the light.
- **Floor.** A lit light is never scaled to dark by the ceiling: it keeps at least level 1 of its strongest channel under any ceiling of 511 mA or more on the hub board (the idle draw of its 480 lights is 480 mA and 390 lights at level 1 add 31 mA). Under that the ceiling wins: lights go dark from the highest index first until the estimate fits and at or under 480 mA the frame is dark. The lowest ceiling the firmware ever sets is 512 mA, the 2.5 A supply setting.

**Forced falls, rises and waiting lights.** Three more things the guard does, each tested.
- **Releasing held lights when the ceiling falls.** A light a rule holds can carry brightness from a higher ceiling. The guard releases it through the rules before it touches the scale: held lights are lowered (still lit, only dimmer) as far as the new ceiling needs, so the requested lights keep their scale and a steady frame does not dim when the ceiling falls from 2700 to 600 mA. Only if even floor level holds do not fit is the scale lowered as well. The only frames that leave the guard without its rules having judged them are those at a ceiling under 511 mA (never set) and at 0.
- **Rises are limited directly.** A fall the guard did not choose (the ceiling's) could otherwise let a light rise a fourth time in a second. A light (3 large rises) or the strip's total (2) that has already made that many large rises in the last second is cut back to just under a large rise above its low state until the oldest rise is a second old.
- **Waiting lights are served oldest first.** The fall budget (30 lights a second) goes to the light that has been asked dark the longest, so a high-index light (the fret and aux outputs) cannot be starved by busier lights lower down. The longest a light can be kept lit after it was asked dark is about 2 seconds with fewer than 30 waiting and 14 seconds with all 390 asked at once (`OutputGuard::kFallWaitBoundMs`, tested).
- **Off to on is limited directly.** Each light may come on from dark at most 3 times in any second whatever darkened it (a forced fall, a ceiling of 0, a mode change). With 3 in the window it stays dark until the oldest is a second old. A key that has not been lit lately lights at once. The strip's own limit on rises is the one on its total luminance, which every light coming on adds to. This was found with a ceiling that flapped to 0: before, a light came on 5 times in a second at one drop every 200 ms and 25 times at one every 40 ms.
- **The supply ceiling cannot flap.** After the inlet drops the ceiling stays at 0 for at least 1 second. The inlet counts as back only after the reading has been present without a break for 500 ms (`InletGate`). A loose plug or noise on SENSE_VIN then cannot blink the lights, even before the per-light limit acts.
- **Re-lights are counted across the strip.** A light that comes on within a second of going dark is a re-light and at most 30 of them are allowed in any second across all outputs (3 x 10, the same area allowance as the falls), to the light that has been dark longest. A light dark for more than a second is free, so a lesson start is not starved: after a stop of under a second only 30 guides come at once and the rest follow in under a second. The strip's luminance limit cannot see one group rising while another falls with the total level, so without this count two halves of the bar could swap at 3 Hz (each light 3 on a second) with every other limit passing.
- **Dark at once.** A stop, a mode change, the end of a lesson and the end of the insecure-mode banner skip the fall queue (`OutputGuard::darkNow`), so they go dark in the next frame and not over up to a second or more. The guard honours it at most once a second, whatever calls it (a call inside the second falls through the normal fall queue), so no caller can drive it fast. The hub keeps its own once-a-second check as well, for a sink that is not the guard. It bypasses the fall queue and nothing else: every change is counted, every later relight counts against the light's 3 off-to-on changes and the strip's 30 re-lights. The holds, the rise limits and the ceiling still apply. Without the queue falls are not capped and what stops a flash is that a light cannot come back quickly. The audio gate reads the same inlet gate as the ceiling and the host port.
- **The insecure-mode banner** used to light all 180 keys for 2 seconds every 30 seconds and wipe out over several seconds, a large regular rise. It now lights ten keys, spread evenly along the bar, in dim white for 2 seconds every 30, which is inside the strip's small-area allowance and it goes out in the next frame. It is one slow on and off, never a flash and the same with reduced motion. Serial still says why.
- **No supply.** At a ceiling of 0 (the inlet dropped, the strip has no supply) every light goes dark at once. That forced fall is counted and is not limited, on purpose: there is nothing to show and a light held lit would draw current the supply cannot give. When the supply returns the lights rise from dark as a fresh start, each inside the per-light off-to-on limit.

Colour: the general definition treats a flash to or from saturated red (red 80 per cent or more of the light) separately. No colour this firmware sends is that red (the colours are amber at 63 per cent red, rose-magenta at 61 per cent, blue and white) and a test renders every role, hand, motion and monochrome setting at several levels and checks it. So the colour rule cannot apply at the sink and rule 2 covers the luminance of every colour that can occur.

Host tests drive the MIDI jack, USB, a Bluetooth host toggling 48 guides, Listen mode at 240 bpm on sixteenths, mashed wrong notes and the glow at 20 Hz and count at the strip both the off to on edges and the large brightness rises, with their own copy of the rule. In Listen at 240 bpm on sixteenths the same key moved between its full guide level and its dim upcoming level about 16 times a second without going out. With the swing limit switched off the test counts at least 10 rises a second at the strip and with it on at most 3. The hostile-source test (a light swapped between bright and dim every millisecond) fails with the limit off too.

What this does not cover: how fast the content changes the brightness of several different lights at once, each within its own limit and anything the LEDs' real light output does that the model above does not predict. Both need a board.

The wrong-note blink itself is two flashes at 2 Hz. A new warning may only start 1000 ms after a blinking one began or 500 ms after a steady one, so wrong lights are at least 500 ms apart across the whole bar. A wrong note inside that gap is still scored and counted in `wrongUnlit` but not lit again.

## Reduced motion (`practice calm on`)

It takes effect at once, in the middle of a session: the engine and the renderer both read the live setting. Under it nothing blinks, pulses or hops. A wrong light is one steady light for 800 ms (a blink that was already running turns steady), the upcoming light is steady at 30 percent and the approach dot is replaced by the steady upcoming light.

## Timing from key press to light

Modelled on the host, not measured on a board. What the host test measures is only the firmware's own part: a press that reaches the bus is shown to the strip in the very next loop pass and the strip is latched 6 ms later, which is the time the fake strip is charged for 180 LEDs (30 us each and a 300 us reset).

| Step | Figure | Source |
| --- | --- | --- |
| Transport | MIDI jack 0.96 ms for a 3 byte message at 31 250 baud. USB at most 1 ms poll plus the host stack, unmeasured. Bluetooth one connection interval, 7.5 to 15 ms or more | Arithmetic and the Bluetooth specification |
| Wait for the loop | Up to 6 ms: a pass that has just pushed a frame is blocked by the strip's output | The 6 ms above |
| Firmware logic | One pass, at most 32 events and 48 lights | Tested |
| Strip output | 6 ms | Modelled |

That adds to about 13 ms from a key press on the MIDI jack in the worst case (1 + 6 + 6), not the under 9 ms an earlier version of this page claimed and to more than 20 ms over Bluetooth. The 7 ms test figure is the firmware and strip part only. A burst of 255 queued events drains in at most 8 passes. A frame that has not changed is not sent to the strip.

## Power

The total LED current is capped in software at 2700 mA, one named constant (`kLedCurrentCeilingMa` in `lib/practice/render.h`) that the hub board's power budget sets: 4.463 A in all (LED bars 2.70 A, the keyboard's USB port 1.184 A (the port switch's highest limit with R14 1 per cent low), the module and logic 0.55 A, audio 0.02 A, the buzzer 0.005 A, the encoder pull-ups 0.004 A) against a resettable fuse that holds 4.62 A at 50 C. The ceiling is a TOTAL over every strip the hub drives (the key, fret and aux outputs are one frame to the guard) and never a figure per strip. The flash limits count across all outputs together because the lights are seen together. Host tests light all three at once. The second and third output **await a board**. The output guard applies it as the very last step before the pixels reach the strip and a setting cannot raise it. A test adds an overlay after the renderer and checks it cannot get past. Each colour channel at full draws 20 mA and an idle LED 1 mA, so a frame draws `sum of channel values x 20 / 255 + LEDs` mA. At full drive a colour draws `sum of its channels x 20 / 255` mA plus 1 mA idle: amber (255, 150, 0) 32 mA, blue (0, 110, 255) 29 mA and rose-magenta (255, 0, 160) 33 mA, where white (the monochrome setting) draws 61 mA. On the hub board the guard counts 480 lights (180 + 150 + the third output at its maximum of 150), so an all white frame is 480 x 60 + 480 = 29 280 mA and the scale against 2700 mA is (2700 - 480) x 255 / (28 800 x 20) = 7.7 percent. The strip the engine drives alone is 180 white LEDs at 180 x 60 + 180 = 10 980 mA. The worst coloured frames are every LED rose-magenta at 6038 mA and every LED amber at 5897 mA. Against 2700 mA they are scaled by (2700 - 180) x 255 / (sum x 20): about 45 percent for all rose-magenta, 46 percent for all amber and 23 percent for all white. Those are the figures for the 180 light key strip alone. With all 480 lights counted on the hub board the scales are 14 percent for all rose-magenta, 15 percent for all amber and 7.7 percent for all white. These cannot happen from the engine, which lights at most 48 cues and a host test holds them under the ceiling anyway. For the white frame the limiter scales every channel by `(2700 - 180) x 255 / (sum x 20)` as a fraction of 256, rounded down, which is about 23 percent. The test checks that frame, 2000 random frames and a ten-note chord and that a ceiling under the idle draw gives a dark frame. FastLED keeps its own limit as a last resort and it is set so it cannot fight the guard: FastLED (read in its source) sums the power of all its controllers, charges a 250 mW baseline for the MCU against the same budget, uses its own lighter per-channel figures and lowers the global brightness when over, which would change lights without regard for the flash limits. Its budget is therefore the guard's 2700 mA plus a 100 mA margin plus that baseline, so it acts only if the guard has failed. The default master brightness is half (128 of 255).

### A smaller power adapter

The board's 2700 mA assumes a 5 A supply. For a smaller adapter the owner sets its rating with `provision supply <mA>` (2500 to 6000). The ceiling becomes `rating x 0.91 - 1763` mA, never above 2700: 91 percent of the rating is usable and 1763 mA go to the other loads: the keyboard port (1184), the module and logic (550), audio (20), the buzzer (5) and the encoder pull-ups (4). A 3 A adapter gives 967 mA. The new ceiling applies as soon as the command is accepted, with no restart. Unset means the board as specified, a 5 A supply and 2700 mA.

### While audio runs

While audio capture is on, a second and lower ceiling also applies, `kLedCeilingWithAudioMa`, **1200 mA**, the board's figure: it keeps the audio converter's supply at 4.60 V from a 5.00 V inlet and at 4.50 V from 4.90 V, with the keyboard port at its limit. The lower of the ceilings always wins. This is a quality rule and not a safety one: the converter below 4.5 V is out of specification, not at risk.

The firmware cannot measure the converter's supply. It reads only the 5 V rail through `SENSE_5V` (GPIO 1, half the rail), with the ADC's highest attenuation range and its calibrated reading. Espressif's ESP32-S3 data sheet (v2.2, table 5-6) gives 50 mV total error after calibration at 25 C in that range, which is 100 mV on the rail and the 1 per cent divider adds about 50 mV: **plus or minus 150 mV on the rail**. That reading is a coarse backstop. While audio runs, a rail that reads below 4.47 V (4.62 V less that 150 mV, 2.235 V on the pin) lowers the ceiling to 900 mA and below 4.37 V to 600 mA. A step comes back only 0.1 V above the level that entered it, so a wobbling reading does not make the ceiling chatter. The fixed 1200 mA is the rule that does the work. The firmware does not hold the rail to any figure, because it cannot measure one that finely. The scale drops at once when the frame would draw too much and comes back up only once a second, in one step and the guard judges the frame that is then shown, so the ceiling cannot make a light swing. A change of ceiling is shown at the next pass even when the frame has not changed: a host test lowers the ceiling over a steady frame and checks the shown current is under it within 20 ms and that no light goes dark in the change.

## Using it

Until the Studio can send lessons the hub has one built-in scale for bring-up. On the serial port:

```text
practice melody
practice rhythm
practice listen
practice off
practice calm on
```

## Not tested

Colour rendering on real LEDs, the look of the pulse and the dot, the true strip time and the loop period on a board. Whether the chosen blue and amber are distinguishable by people with the common colour vision differences needs people to try it.

## Audio input needs the DC inlet

See [pins-and-power.md](pins-and-power.md) for how the hub tells the DC inlet from USB power. Without the inlet the hub refuses audio input, switches it off if the inlet goes away, keeps the keyboard port off and holds the strip dark. The refusal is a plain message on serial and in the JSON reply the Studio will get: `audio input needs the DC power inlet: on USB-C power alone the 5 V rail is too low for the audio converter`. On the serial port: `audio on` or `audio off`. The audio capture itself is not built yet: this is the gate it will sit behind.
