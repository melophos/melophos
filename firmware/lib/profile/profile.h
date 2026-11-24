#pragma once

#include <stddef.h>
#include <stdint.h>

#include "keymap.h"

namespace melophos {

// limits for anything a profile can ask of the hub. The same numbers are in
// profiles/schema.json so the Studio refuses what the hub would refuse.
namespace limits {
const size_t kProfileJsonBytes = 1024;
const size_t kIdMax = 32;
const size_t kNameMax = 64;
const int kMaxStrings = 8;
const int kMaxFrets = 36;
const float kWhiteKeyMmMin = 5.0f;
const float kWhiteKeyMmMax = 50.0f;
const float kDensityMin = 10.0f;
const float kDensityMax = 300.0f;
const int kOffsetMax = 32;
const int kKeyLedsMax = 180;   // equals MAX_KEY_LEDS in melophos_config.h
const int kFretLedsMax = 150;  // equals MAX_FRET_LEDS in melophos_config.h
}  // namespace limits

enum class ProfileType : uint8_t { Keyboard = 0, Fretboard = 1 };
enum class ProfileLayout : uint8_t { PerKey = 0, Strip = 1, Grid = 2 };

struct Profile {
    char id[limits::kIdMax + 1];
    char name[limits::kNameMax + 1];
    ProfileType type;
    ProfileLayout layout;
    uint8_t lowest;
    uint8_t highest;
    uint16_t whiteKeyCentiMm;  // 2350 is 23.5 mm
    uint16_t densityDeciPerM;  // 1440 is 144 LEDs per metre
    uint8_t offset;
    bool reversed;
    bool serpentine;
    uint8_t stringCount;
    uint8_t strings[limits::kMaxStrings];
    uint8_t frets;
};

struct ProfileResult {
    bool ok;
    char message[96];
};

// parses and validates a profile document from the Studio. Nothing is
// trusted: every number is bounded and the LED count must fit the strip.
ProfileResult parseProfile(const char *json, size_t length, Profile &out);

// the profile every hub falls back to, equal to profiles/piano-88.json.
Profile defaultProfile();

// fixed-size little-endian form used in flash. Returns the byte count.
const size_t kProfileBytes = (limits::kIdMax + 1) + (limits::kNameMax + 1) + 12 + 8;
size_t encodeProfile(const Profile &p, uint8_t *out, size_t cap);
// decodes and re-validates, so a record that survives its checksum but holds
// out-of-range values is still refused.
bool decodeProfile(const uint8_t *in, size_t length, Profile &out);

KeyboardProfile toKeyboardProfile(const Profile &p);
int profileLedCount(const Profile &p);

}  // namespace melophos
