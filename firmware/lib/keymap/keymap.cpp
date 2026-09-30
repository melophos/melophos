#include "keymap.h"

#include <math.h>

namespace melophos {

namespace {

// White keys below each pitch class inside one octave, starting from C.
const uint8_t kWhiteBefore[12] = {0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6};
const bool kBlack[12] = {false, true, false, true, false, false, true, false, true, false, true, false};

int whiteKeysBelow(uint8_t note) {
    return (note / 12) * 7 + kWhiteBefore[note % 12];
}

// Left edge of the lowest key in white-key units. A black lowest key is rare
// but possible on a custom profile, so its left edge sits half a white key back.
float leftEdgeUnits(uint8_t lowest) {
    float edge = (float)whiteKeysBelow(lowest);
    return kBlack[lowest % 12] ? edge - 0.5f : edge;
}

}  // namespace

bool isBlackKey(uint8_t note) {
    return kBlack[note % 12];
}

float keyCentreMm(const KeyboardProfile &p, uint8_t note) {
    // A black key is drawn centred on the boundary between its two white
    // neighbours. Real keybeds shift some black keys slightly, but the error
    // stays well under one LED pitch at 144 LEDs/m.
    float centreUnits = (float)whiteKeysBelow(note) + (kBlack[note % 12] ? 0.0f : 0.5f);
    return (centreUnits - leftEdgeUnits(p.lowest)) * p.whiteKeyMm;
}

int ledCount(const KeyboardProfile &p) {
    if (p.layout == LedLayout::PerKey) {
        return p.highest - p.lowest + 1 + p.offset;
    }
    float widthMm = (float)(whiteKeysBelow(p.highest) + (kBlack[p.highest % 12] ? 0 : 1)) * p.whiteKeyMm -
                    leftEdgeUnits(p.lowest) * p.whiteKeyMm;
    float pitchMm = 1000.0f / p.densityPerM;
    return (int)ceilf(widthMm / pitchMm) + p.offset;
}

int ledIndexForNote(const KeyboardProfile &p, uint8_t note) {
    if (note < p.lowest || note > p.highest) {
        return -1;
    }
    int index;
    if (p.layout == LedLayout::PerKey) {
        index = note - p.lowest + p.offset;
    } else {
        float pitchMm = 1000.0f / p.densityPerM;
        index = (int)floorf(keyCentreMm(p, note) / pitchMm) + p.offset;
    }
    if (p.reversed) {
        index = ledCount(p) - 1 - (index - p.offset) + p.offset;
    }
    return index;
}

}  // namespace melophos
