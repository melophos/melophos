#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "keymap.h"
#include "practice.h"

namespace melophos {

// every meaning has a colour AND at least one signal that survives losing
// colour. Brightness is a percentage of the master level.
//
//   role            colour        brightness  pattern                  ends
//   guide, right    amber         100         steady                   when the note is played (the light goes out)
//   guide, left     blue          70          steady                   when the note is played (the light goes out)
//   played          amber         55          steady while held        at key release (free play and Listen)
//   upcoming        hand's hue    20 to 40    1 Hz pulse (steady 30    when it becomes the guide
//                                             with reduced motion)
//   wrong           rose-magenta  100         2 Hz blink, two flashes  by itself after 750 ms
//                                             (steady 800 ms with reduced motion),
//                                             on the key that was pressed, never the guide key
//
// The moving approach dot (rhythm) is also position: it sits up to three
// keys below the target and hops once every 500 ms.
// the third (aux) output on connector J14. Two named figures:
//   kAuxLedsMax      the longest strip the hub supports there, a HARD maximum (a placeholder until the owner gives the
//                    real one). A longer strip is not supported: the strip sends nothing back, so the firmware
//                    cannot detect one and only the board's resettable fuse and the budget's margin stand behind it
//   the length in use  a stored setting (default kAuxLedsDefault, refused above the maximum). Data is sent only to
//                    that many lights
// The guard ALWAYS reserves the idle draw of the maximum length (about 1 mA a light) whatever length is in use, so a
// strip up to the maximum can never put the total over the ceiling even when its extra lights receive no data. The
// bring-up board has no third output and sets MELOPHOS_AUX_LEDS_MAX to 0
#ifndef MELOPHOS_AUX_LEDS_MAX
#define MELOPHOS_AUX_LEDS_MAX 150
#endif
const size_t kAuxLedsMax = MELOPHOS_AUX_LEDS_MAX;
const size_t kAuxLedsDefault = kAuxLedsMax < 60 ? kAuxLedsMax : 60;

// how many lights the guard holds across every output the hub drives: the key strip (180), the fret strip (150) and
// the third output at its maximum. The hub board drives all three. The bring-up board drives only the key strip and
// sets MELOPHOS_GUARD_LEDS to 180 to save RAM. The counts per output are in include/melophos_config.h and test_pins
// checks they add up
#ifndef MELOPHOS_GUARD_LEDS
#define MELOPHOS_GUARD_LEDS (180 + 150 + MELOPHOS_AUX_LEDS_MAX)
#endif
const size_t kGuardLeds = MELOPHOS_GUARD_LEDS;

// the board's loads besides the LEDs, in mA, each from its own figure in the budget. kOtherLoadsMa is their sum and
// the supply rule below reserves exactly that, so the two never drift apart
const uint16_t kKeyboardPortMa = 1184;  // the port switch's highest limit with R14 1 per cent low
const uint16_t kModuleLogicMa = 550;
const uint16_t kAudioMa = 20;
const uint16_t kBuzzerMa = 5;
const uint16_t kEncoderMa = 4;  // the pull-ups
const uint16_t kOtherLoadsMa = kKeyboardPortMa + kModuleLogicMa + kAudioMa + kBuzzerMa + kEncoderMa;  // 1763

// the LED current ceiling, one figure for the whole firmware. it is a TOTAL across every strip the hub drives,
// never a figure per strip: the output guard judges one frame that holds all of them. the hub board sets it
// from its power budget: 4.463 A in all (LED bars 2.70 A and 1.763 A of other loads, listed above) against a
// resettable fuse that holds 4.62 A at 50 C. the LED share is 2.70 A. change it only when the board does.
const uint16_t kLedCurrentCeilingMa = 2700;

// while audio capture runs the ceiling is lower. The board's figure: at 1200 mA the audio converter's
// supply stays at 4.60 V from a 5.00 V inlet and at 4.50 V from 4.90 V, with the keyboard port at its
// limit. This is a quality rule, not a safety one: the converter below 4.5 V is out of specification, not
// at risk. The hub cannot measure the converter's supply. It reads only the rail through SENSE_5V.
const uint16_t kLedCeilingWithAudioMa = 1200;

// A coarse backstop on top of that, while audio runs. SENSE_5V reads half the rail, through the ADC's
// highest attenuation range and its calibrated reading. Espressif's ESP32-S3 data sheet (v2.2, table 5-6)
// gives 50 mV total error after calibration at 25 C in that range, which is 100 mV on the rail and the
// 1 per cent divider adds about 50 mV: plus or minus 150 mV on the rail. So the backstop acts only when the
// rail reads under 4.47 V (4.62 V less 150 mV), 2.235 V on the pin and in a second step under 4.37 V.
// Each step has hysteresis: it comes back only after the rail is 0.1 V above the level that lowered it.
// The fixed 1200 mA ceiling is the rule that does the work. This does not hold the rail to any figure.
const uint16_t kRailStepCeilingMa[3] = {1200, 900, 600};  // step 0 is the board's figure
uint8_t railStepFor(uint8_t currentStep, uint16_t pinMilliVolts);

// the ceiling for a supply of the given rating. the board's own budget holds 2700 mA of LEDs on a 5 A
// supply. a smaller adapter leaves less: 91 percent of the rating is usable and kOtherLoadsMa (1763) goes to the
// other loads, so a 3 A adapter gives 3000 x 0.91 - 1763 = 967 mA. never above the board's own 2700. below 2500 mA
// the board is not supported
uint16_t ledCeilingForSupply(uint16_t supplyMa);

// the supply ceiling the guard is given: the rating's ceiling while the inlet is present and 0 without it. main calls
// it whenever either changes, so a new rating takes effect at once and not at the next restart
uint16_t supplyCeilingFor(bool inletPresent, uint16_t supplyMa);

struct RenderSettings {
    uint8_t master = 128;        // 0 to 255, before the current ceiling
    bool reducedMotion = false;  // steady lights only, no blink, pulse or approach dot
    bool monochrome = false;     // every role white: shape and brightness only
    uint16_t ceilingMa = kLedCurrentCeilingMa;
};

// relative luminance of a pixel, 0 to 1000 where 1000 is full white (255, 255, 255). An LED's light is
// proportional to the value sent (the strip is driven by PWM), so the value is already linear light and the
// weights are the Rec. 709 ones, 0.2126, 0.7152 and 0.0722, applied without a gamma step. The real light
// per channel differs from the weights (the blue die gives less light per mA) and that needs measuring on a
// board, so the limit below keeps a margin.
uint16_t relativeLuminance(const Rgb &p);

// estimated draw: each colour channel at 255 draws 20 mA and each LED idles at
// 1 mA. millis = sum(channel values) * 20 / 255 + count.
uint32_t estimateMilliamps(const Rgb *pixels, size_t count);

// scales the frame down so estimateMilliamps() never exceeds the ceiling. The estimate after the level 1 floor is
// never over it either: if the floor cannot fit, lights go dark in a fixed order, the highest index first.
// Worst case on the hub board: 480 lights (idle draw 480 mA, the aux output counted at its maximum) all white
// draw 480 * 60 + 480 = 29.3 A, so against 2700 mA the scale is at most (2700 - 480) / 28800 = 7.7 percent.
// Returns the scale applied, 0 to 256.
uint16_t applyCeiling(Rgb *pixels, size_t count, uint16_t ceilingMa);

// the level 0 to 255 a cue shows at a given age, before master and colour.
uint8_t cueLevel(const Cue &cue, uint32_t nowMs, bool reducedMotion);

// composes the cues onto the strip. Priority per LED: wrong, guide, played,
// upcoming. Notes outside the profile or the strip are skipped.
void renderFrame(const KeyboardProfile &profile, const CueList &cues, uint32_t nowMs, const RenderSettings &settings,
                 Rgb *pixels, size_t count);

}  // namespace melophos
