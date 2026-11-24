#include "render.h"

#include <string.h>

namespace melophos {

namespace {

// the light language the Studio shares (studio/src/styles/lights.json): amber is the
// next note and the right hand, blue is the left hand and rose-magenta is a wrong
// note. Pure red sits too close to amber under the commonest colour vision
// difference. The name kRed is kept because the Studio's drift test reads it
const uint8_t kBlue[3] = {0, 110, 255};
const uint8_t kAmber[3] = {255, 150, 0};
const uint8_t kRed[3] = {255, 0, 160};
const uint8_t kWhite[3] = {255, 255, 255};

int priority(LightRole r) {
    switch (r) {
        case LightRole::Wrong:
            return 3;
        case LightRole::Guide:
            return 2;
        case LightRole::Played:
            return 1;
        default:
            return 0;
    }
}

}  // namespace

uint16_t relativeLuminance(const Rgb &p) {
    return (uint16_t)((2126u * p.r + 7152u * p.g + 722u * p.b) / 2550u);
}

uint8_t railStepFor(uint8_t step, uint16_t pinMv) {
    // pin millivolts at which a step is entered: 4.47 V on the rail (4.62 V less the 150 mV error band) and
    // 4.37 V. A step is left again 100 mV on the rail (50 mV on the pin) above where it was entered
    static const uint16_t enter[3] = {0, 2235, 2185};
    if (step > 2) {
        step = 2;
    }
    while (step < 2 && pinMv < enter[step + 1]) {
        step++;
    }
    while (step > 0 && pinMv >= enter[step] + 50) {
        step--;
    }
    return step;
}

uint16_t ledCeilingForSupply(uint16_t supplyMa) {
    if (supplyMa < 2500) {
        return 0;  // the caller refuses such a setting
    }
    int32_t usable = (int32_t)supplyMa * 91 / 100 - (int32_t)kOtherLoadsMa;
    if (usable < 0) {
        usable = 0;
    }
    return usable > kLedCurrentCeilingMa ? kLedCurrentCeilingMa : (uint16_t)usable;
}

uint16_t supplyCeilingFor(bool inletPresent, uint16_t supplyMa) {
    return inletPresent ? ledCeilingForSupply(supplyMa) : 0;
}

uint32_t estimateMilliamps(const Rgb *pixels, size_t count) {
    uint64_t sum = 0;
    for (size_t i = 0; i < count; i++) {
        sum += (uint32_t)pixels[i].r + pixels[i].g + pixels[i].b;
    }
    return (uint32_t)(sum * 20u / 255u + count);
}

namespace {

// one light at a scale (0 to 256), with the floor: a lit light keeps level 1 of its strongest channel
Rgb atScale(const Rgb &in, uint32_t scale) {
    if (scale >= 256) {
        return in;
    }
    Rgb o{(uint8_t)((uint32_t)in.r * scale >> 8), (uint8_t)((uint32_t)in.g * scale >> 8), (uint8_t)((uint32_t)in.b * scale >> 8)};
    if ((in.r | in.g | in.b) != 0 && (o.r | o.g | o.b) == 0) {
        if (in.r >= in.g && in.r >= in.b) {
            o.r = 1;
        } else if (in.g >= in.b) {
            o.g = 1;
        } else {
            o.b = 1;
        }
    }
    return o;
}

uint64_t sumAtScale(const Rgb *pixels, size_t count, uint32_t scale) {
    uint64_t sum = 0;
    for (size_t i = 0; i < count; i++) {
        Rgb o = atScale(pixels[i], scale);
        sum += (uint32_t)o.r + o.g + o.b;
    }
    return sum;
}

}  // namespace

uint16_t applyCeiling(Rgb *pixels, size_t count, uint16_t ceilingMa) {
    uint64_t idle = count;
    if (ceilingMa <= idle) {
        memset(pixels, 0, count * sizeof(Rgb));  // not even the idle draw fits: dark is the only safe frame
        return 0;
    }
    uint64_t allowed = ceilingMa - idle;
    // draw = sum * 20 / 255. the floor is part of the draw, so the scale is the LARGEST one at which the frame WITH
    // the floor fits. Settling it here and not by darkening lights afterwards, is what keeps a steady frame steady
    if (sumAtScale(pixels, count, 256) * 20u <= allowed * 255u) {
        return 256;
    }
    uint32_t lo = 0, hi = 256;  // fits at lo (if at all), does not fit at hi
    if (sumAtScale(pixels, count, 0) * 20u > allowed * 255u) {
        lo = 0;
    } else {
        while (hi - lo > 1) {
            uint32_t mid = (lo + hi) / 2;
            if (sumAtScale(pixels, count, mid) * 20u <= allowed * 255u) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
    }
    uint32_t scale = lo;
    for (size_t i = 0; i < count; i++) {
        pixels[i] = atScale(pixels[i], scale);
    }
    // only when even every lit light at level 1 does not fit (a ceiling under 511 mA with every light that can be lit on the hub
    // board, which the firmware never sets: the lowest is 512) does anything go dark, in a fixed order, the highest index first
    uint64_t after = 0;
    for (size_t i = 0; i < count; i++) {
        after += (uint32_t)pixels[i].r + pixels[i].g + pixels[i].b;
    }
    for (size_t i = count; i > 0 && after * 20u > allowed * 255u; i--) {
        Rgb &p = pixels[i - 1];
        after -= (uint32_t)p.r + p.g + p.b;
        p = Rgb{0, 0, 0};
    }
    return (uint16_t)scale;
}

uint8_t cueLevel(const Cue &cue, uint32_t nowMs, bool reducedMotion) {
    uint32_t age = nowMs - cue.startMs;
    switch (cue.role) {
        case LightRole::Guide:
            return cue.left ? 178 : 255;  // the left hand is 70 percent: a second signal besides its blue
        case LightRole::Played:
            return 140;
        case LightRole::Upcoming:
            if (reducedMotion) {
                return 77;
            }
            if (cue.lead > 0) {
                return 100;  // the approach dot, a little brighter than the resting upcoming light
            }
            {
                // 1 Hz triangle between 51 (20 percent) and 102 (40 percent)
                uint32_t phase = nowMs % 1000u;
                uint32_t tri = phase < 500 ? phase : 1000 - phase;
                return (uint8_t)(51 + tri * 51 / 500);
            }
        case LightRole::Wrong:
        default:
            if (cue.blink && !reducedMotion) {  // a blink that started before calm mode was switched on turns steady
                if (age >= timing::kWrongBlinkTotalMs) {
                    return 0;
                }
                return (age % timing::kWrongBlinkPeriodMs) < timing::kWrongBlinkPeriodMs / 2 ? 255 : 0;
            }
            return age < timing::kWrongSteadyMs ? 255 : 0;
    }
}

void renderFrame(const KeyboardProfile &profile, const CueList &cues, uint32_t nowMs, const RenderSettings &settings,
                 Rgb *pixels, size_t count) {
    memset(pixels, 0, count * sizeof(Rgb));
    int best[256];
    size_t limit = count < 256 ? count : 256;
    for (size_t i = 0; i < limit; i++) {
        best[i] = -1;
    }
    for (size_t c = 0; c < cues.count; c++) {
        const Cue &cue = cues.cue[c];
        int index = ledIndexForNote(profile, cue.note);
        if (cue.role == LightRole::Upcoming && cue.lead > 0 && index >= 0) {
            index -= cue.lead;  // the approach dot trails the target
            if (index < 0) {
                index = ledIndexForNote(profile, cue.note);
            }
        }
        if (index < 0 || (size_t)index >= limit) {
            continue;
        }
        int p = priority(cue.role);
        if (p < best[index]) {
            continue;
        }
        uint8_t level = cueLevel(cue, nowMs, settings.reducedMotion);
        if (p == best[index] && level < 1) {
            continue;
        }
        best[index] = p;
        const uint8_t *base = settings.monochrome ? kWhite
                              : cue.role == LightRole::Wrong  ? kRed
                              : cue.role == LightRole::Played ? kAmber
                              : cue.left                      ? kBlue
                                                              : kAmber;
        uint32_t scale = (uint32_t)level * settings.master / 255u;  // 0 to 255
        pixels[index].r = (uint8_t)(base[0] * scale / 255u);
        pixels[index].g = (uint8_t)(base[1] * scale / 255u);
        pixels[index].b = (uint8_t)(base[2] * scale / 255u);
    }
    applyCeiling(pixels, count, settings.ceilingMa);
}

}  // namespace melophos
