#pragma once

#include <stdint.h>

namespace melophos {

enum class LedLayout : uint8_t { PerKey, Strip };

// Keyboard half of an instrument profile, see profiles/schema.json.
struct KeyboardProfile {
    uint8_t lowest;
    uint8_t highest;
    float whiteKeyMm;
    LedLayout layout;
    float densityPerM;  // strip only
    int16_t offset;
    bool reversed;
};

bool isBlackKey(uint8_t note);

float keyCentreMm(const KeyboardProfile &p, uint8_t note);

int ledCount(const KeyboardProfile &p);

// -1 when the note is outside the instrument's range
int ledIndexForNote(const KeyboardProfile &p, uint8_t note);

}  // namespace melophos
