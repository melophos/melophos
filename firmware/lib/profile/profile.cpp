#include "profile.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "jsonlite.h"

namespace melophos {

namespace {

enum Field : uint32_t {
    kId = 1u << 0,
    kName = 1u << 1,
    kType = 1u << 2,
    kLowest = 1u << 3,
    kHighest = 1u << 4,
    kWhiteKey = 1u << 5,
    kStrings = 1u << 6,
    kFrets = 1u << 7,
    kLayout = 1u << 8,
    kDensity = 1u << 9,
    kOffset = 1u << 10,
    kReversed = 1u << 11,
    kSerpentine = 1u << 12,
    kSchemaRef = 1u << 13,
};

bool isWhole(double v) {
    return v == floor(v);
}

bool validId(const char *s) {
    size_t n = strlen(s);
    if (n == 0 || n > limits::kIdMax) {
        return false;
    }
    bool dashBefore = true;  // also rejects a leading dash
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        bool alnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        if (alnum) {
            dashBefore = false;
        } else if (c == '-' && !dashBefore) {
            dashBefore = true;
        } else {
            return false;
        }
    }
    return !dashBefore;
}

class ProfileSink : public JsonSink {
   public:
    Profile p{};
    uint32_t seen = 0;
    char error[96] = "";
    bool layoutSet = false;

    bool leaf(const char *path, JsonKind kind, const char *text, double num, bool flag) override {
        if (!strcmp(path, "$schema")) {
            return mark(kSchemaRef, path) && wantString(path, kind);
        }
        if (!strcmp(path, "id")) {
            if (!mark(kId, path) || !wantString(path, kind)) {
                return false;
            }
            if (!validId(text)) {
                return fail("id must be 1 to 32 lowercase letters or digits joined by single dashes");
            }
            strcpy(p.id, text);
            return true;
        }
        if (!strcmp(path, "name")) {
            if (!mark(kName, path) || !wantString(path, kind)) {
                return false;
            }
            size_t n = strlen(text);
            if (n == 0 || n > limits::kNameMax) {
                return fail("name must be 1 to 64 characters");
            }
            strcpy(p.name, text);
            return true;
        }
        if (!strcmp(path, "type")) {
            if (!mark(kType, path) || !wantString(path, kind)) {
                return false;
            }
            if (!strcmp(text, "keyboard")) {
                p.type = ProfileType::Keyboard;
            } else if (!strcmp(text, "fretboard")) {
                p.type = ProfileType::Fretboard;
            } else {
                return fail("type must be keyboard or fretboard");
            }
            return true;
        }
        if (!strcmp(path, "notes.lowest")) {
            return mark(kLowest, path) && midi(path, kind, num, p.lowest);
        }
        if (!strcmp(path, "notes.highest")) {
            return mark(kHighest, path) && midi(path, kind, num, p.highest);
        }
        if (!strcmp(path, "geometry.white_key_mm")) {
            if (!mark(kWhiteKey, path) || !wantNumber(path, kind)) {
                return false;
            }
            if (num < limits::kWhiteKeyMmMin || num > limits::kWhiteKeyMmMax) {
                return fail("geometry.white_key_mm must be between 5 and 50");
            }
            p.whiteKeyCentiMm = (uint16_t)lround(num * 100.0);
            return true;
        }
        if (!strncmp(path, "strings[", 8)) {
            if (!wantNumber(path, kind)) {
                return false;
            }
            int index = atoi(path + 8);
            if (index >= limits::kMaxStrings) {
                return fail("strings may hold at most 8 notes");
            }
            seen |= kStrings;
            if (num < 0 || num > 127 || !isWhole(num)) {
                return fail("strings must be whole MIDI notes from 0 to 127");
            }
            p.strings[index] = (uint8_t)num;
            if (index + 1 > p.stringCount) {
                p.stringCount = (uint8_t)(index + 1);
            }
            return true;
        }
        if (!strcmp(path, "frets")) {
            if (!mark(kFrets, path) || !wantNumber(path, kind)) {
                return false;
            }
            if (num < 1 || num > limits::kMaxFrets || !isWhole(num)) {
                return fail("frets must be a whole number from 1 to 36");
            }
            p.frets = (uint8_t)num;
            return true;
        }
        if (!strcmp(path, "leds.layout")) {
            if (!mark(kLayout, path) || !wantString(path, kind)) {
                return false;
            }
            if (!strcmp(text, "per-key")) {
                p.layout = ProfileLayout::PerKey;
            } else if (!strcmp(text, "strip")) {
                p.layout = ProfileLayout::Strip;
            } else if (!strcmp(text, "grid")) {
                p.layout = ProfileLayout::Grid;
            } else {
                return fail("leds.layout must be per-key, strip or grid");
            }
            return true;
        }
        if (!strcmp(path, "leds.density_per_m")) {
            if (!mark(kDensity, path) || !wantNumber(path, kind)) {
                return false;
            }
            if (num < limits::kDensityMin || num > limits::kDensityMax) {
                return fail("leds.density_per_m must be between 10 and 300");
            }
            p.densityDeciPerM = (uint16_t)lround(num * 10.0);
            return true;
        }
        if (!strcmp(path, "leds.offset")) {
            if (!mark(kOffset, path) || !wantNumber(path, kind)) {
                return false;
            }
            if (num < 0 || num > limits::kOffsetMax || !isWhole(num)) {
                return fail("leds.offset must be a whole number from 0 to 32");
            }
            p.offset = (uint8_t)num;
            return true;
        }
        if (!strcmp(path, "leds.reversed")) {
            return mark(kReversed, path) && wantBool(path, kind) && (p.reversed = flag, true);
        }
        if (!strcmp(path, "leds.serpentine")) {
            return mark(kSerpentine, path) && wantBool(path, kind) && (p.serpentine = flag, true);
        }
        snprintf(error, sizeof error, "unknown field %.40s", path);
        return false;
    }

   private:
    bool fail(const char *m) {
        snprintf(error, sizeof error, "%s", m);
        return false;
    }
    bool mark(uint32_t bit, const char *path) {
        if (seen & bit) {
            snprintf(error, sizeof error, "%.40s appears twice", path);
            return false;
        }
        seen |= bit;
        return true;
    }
    bool typeError(const char *path, const char *want) {
        snprintf(error, sizeof error, "%.40s must be %s", path, want);
        return false;
    }
    bool wantString(const char *path, JsonKind k) { return k == JsonKind::String || typeError(path, "text"); }
    bool wantNumber(const char *path, JsonKind k) { return k == JsonKind::Number || typeError(path, "a number"); }
    bool wantBool(const char *path, JsonKind k) { return k == JsonKind::Bool || typeError(path, "true or false"); }
    bool midi(const char *path, JsonKind kind, double num, uint8_t &dest) {
        if (!wantNumber(path, kind)) {
            return false;
        }
        if (num < 0 || num > 127 || !isWhole(num)) {
            snprintf(error, sizeof error, "%.40s must be a whole MIDI note from 0 to 127", path);
            return false;
        }
        dest = (uint8_t)num;
        return true;
    }
};

ProfileResult refuse(const char *m) {
    ProfileResult r{false, ""};
    snprintf(r.message, sizeof r.message, "%s", m);
    return r;
}

// the checks that need several fields at once, shared by the JSON path and
// the flash decoder so neither can admit a profile the other would refuse
const char *crossCheck(const Profile &p) {
    if (p.type == ProfileType::Keyboard) {
        if (p.lowest > p.highest) {
            return "notes.lowest must not be above notes.highest";
        }
        if (p.layout == ProfileLayout::Grid) {
            return "a keyboard cannot use the grid layout";
        }
        if (p.whiteKeyCentiMm == 0) {
            return "a keyboard needs geometry.white_key_mm";
        }
        if (p.layout == ProfileLayout::Strip && p.densityDeciPerM == 0) {
            return "the strip layout needs leds.density_per_m";
        }
        int leds = profileLedCount(p);
        if (leds < 1 || leds > limits::kKeyLedsMax) {
            return "the profile needs more LEDs than the hub can drive (180)";
        }
    } else {
        if (p.stringCount == 0 || p.frets == 0) {
            return "a fretboard needs strings and frets";
        }
        if (p.layout != ProfileLayout::Grid) {
            return "a fretboard must use the grid layout";
        }
        if (profileLedCount(p) > limits::kFretLedsMax) {
            return "the grid needs more LEDs than the hub can drive (150)";
        }
    }
    return nullptr;
}

}  // namespace

ProfileResult parseProfile(const char *json, size_t length, Profile &out) {
    ProfileSink sink;
    JsonLimits lim{limits::kProfileJsonBytes, 4, 64, limits::kMaxStrings + 1};
    JsonResult jr = jsonWalk(json, length, lim, sink);
    if (!jr.ok) {
        return refuse(sink.error[0] ? sink.error : jr.message);
    }
    const uint32_t need = kId | kName | kType | kLayout;
    if ((sink.seen & need) != need) {
        return refuse("a profile needs id, name, type and leds.layout");
    }
    Profile &p = sink.p;
    if (p.type == ProfileType::Keyboard) {
        if (!(sink.seen & kLowest) || !(sink.seen & kHighest) || !(sink.seen & kWhiteKey)) {
            return refuse("a keyboard needs notes.lowest, notes.highest and geometry.white_key_mm");
        }
        if (sink.seen & (kStrings | kFrets | kSerpentine)) {
            return refuse("strings, frets and serpentine belong to a fretboard");
        }
    } else {
        if (!(sink.seen & kStrings) || !(sink.seen & kFrets)) {
            return refuse("a fretboard needs strings and frets");
        }
        if (sink.seen & (kLowest | kHighest | kWhiteKey)) {
            return refuse("notes and geometry belong to a keyboard");
        }
    }
    if (p.layout == ProfileLayout::Strip && !(sink.seen & kDensity)) {
        return refuse("the strip layout needs leds.density_per_m");
    }
    if (const char *m = crossCheck(p)) {
        return refuse(m);
    }
    out = p;
    return ProfileResult{true, "ok"};
}

Profile defaultProfile() {
    Profile p{};
    strcpy(p.id, "piano-88");
    strcpy(p.name, "88-key keyboard (A0 to C8)");
    p.type = ProfileType::Keyboard;
    p.layout = ProfileLayout::PerKey;
    p.lowest = 21;
    p.highest = 108;
    p.whiteKeyCentiMm = 2350;
    return p;
}

KeyboardProfile toKeyboardProfile(const Profile &p) {
    return KeyboardProfile{p.lowest,
                           p.highest,
                           p.whiteKeyCentiMm / 100.0f,
                           p.layout == ProfileLayout::Strip ? LedLayout::Strip : LedLayout::PerKey,
                           p.densityDeciPerM / 10.0f,
                           (int16_t)p.offset,
                           p.reversed};
}

int profileLedCount(const Profile &p) {
    if (p.type == ProfileType::Fretboard) {
        return (int)p.stringCount * (int)p.frets;
    }
    if (p.layout == ProfileLayout::Strip && p.densityDeciPerM == 0) {
        return 0;
    }
    return ledCount(toKeyboardProfile(p));
}

size_t encodeProfile(const Profile &p, uint8_t *out, size_t cap) {
    if (cap < kProfileBytes) {
        return 0;
    }
    memset(out, 0, kProfileBytes);
    memcpy(out, p.id, limits::kIdMax + 1);
    memcpy(out + limits::kIdMax + 1, p.name, limits::kNameMax + 1);
    size_t at = limits::kIdMax + 1 + limits::kNameMax + 1;
    out[at++] = (uint8_t)p.type;
    out[at++] = (uint8_t)p.layout;
    out[at++] = p.lowest;
    out[at++] = p.highest;
    out[at++] = (uint8_t)(p.whiteKeyCentiMm & 0xFF);
    out[at++] = (uint8_t)(p.whiteKeyCentiMm >> 8);
    out[at++] = (uint8_t)(p.densityDeciPerM & 0xFF);
    out[at++] = (uint8_t)(p.densityDeciPerM >> 8);
    out[at++] = p.offset;
    out[at++] = (uint8_t)((p.reversed ? 1 : 0) | (p.serpentine ? 2 : 0));
    out[at++] = p.stringCount;
    out[at++] = p.frets;
    memcpy(out + at, p.strings, limits::kMaxStrings);
    return kProfileBytes;
}

bool decodeProfile(const uint8_t *in, size_t length, Profile &out) {
    if (length != kProfileBytes) {
        return false;
    }
    Profile p{};
    memcpy(p.id, in, limits::kIdMax + 1);
    memcpy(p.name, in + limits::kIdMax + 1, limits::kNameMax + 1);
    p.id[limits::kIdMax] = '\0';
    p.name[limits::kNameMax] = '\0';
    size_t at = limits::kIdMax + 1 + limits::kNameMax + 1;
    if (in[at] > 1 || in[at + 1] > 2) {
        return false;
    }
    p.type = (ProfileType)in[at++];
    p.layout = (ProfileLayout)in[at++];
    p.lowest = in[at++];
    p.highest = in[at++];
    p.whiteKeyCentiMm = (uint16_t)(in[at] | (in[at + 1] << 8));
    at += 2;
    p.densityDeciPerM = (uint16_t)(in[at] | (in[at + 1] << 8));
    at += 2;
    p.offset = in[at++];
    p.reversed = in[at] & 1;
    p.serpentine = (in[at++] & 2) != 0;
    p.stringCount = in[at++];
    p.frets = in[at++];
    memcpy(p.strings, in + at, limits::kMaxStrings);
    if (!validId(p.id) || p.name[0] == '\0' || p.lowest > 127 || p.highest > 127 || p.offset > limits::kOffsetMax ||
        p.stringCount > limits::kMaxStrings || p.frets > limits::kMaxFrets) {
        return false;
    }
    if (p.type == ProfileType::Keyboard &&
        (p.whiteKeyCentiMm < 500 || p.whiteKeyCentiMm > 5000 ||
         (p.layout == ProfileLayout::Strip && (p.densityDeciPerM < 100 || p.densityDeciPerM > 3000)))) {
        return false;
    }
    for (int i = 0; i < p.stringCount; i++) {
        if (p.strings[i] > 127) {
            return false;
        }
    }
    if (crossCheck(p) != nullptr) {
        return false;
    }
    out = p;
    return true;
}

}  // namespace melophos
