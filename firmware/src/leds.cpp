#include "leds.h"

#include <FastLED.h>

#include "melophos_config.h"

namespace melophos {

namespace {

CRGB keyLeds[MAX_KEY_LEDS];

CRGB colourFor(LightRole role) {
    switch (role) {
        case LightRole::Guide:
            return CRGB(0, 90, 255);
        case LightRole::Upcoming:
            return CRGB(0, 12, 40);
        case LightRole::Wrong:
            return CRGB(255, 0, 0);
        case LightRole::Played:
        default:
            return CRGB(255, 140, 20);
    }
}

}  // namespace

void Leds::begin(const KeyboardProfile &profile) {
    profile_ = profile;
    int count = ledCount(profile_);
    if (count > MAX_KEY_LEDS) {
        count = MAX_KEY_LEDS;
    }
    FastLED.addLeds<WS2812B, PIN_LED_KEYS, GRB>(keyLeds, count);
    FastLED.setMaxPowerInVoltsAndMilliamps(5, LED_MAX_MILLIAMPS);
    FastLED.setBrightness(LED_BRIGHTNESS);
    clear();
    show();
}

void Leds::setNote(uint8_t note, LightRole role, bool on) {
    int index = ledIndexForNote(profile_, note);
    if (index < 0 || index >= MAX_KEY_LEDS) {
        return;
    }
    keyLeds[index] = on ? colourFor(role) : CRGB::Black;
}

void Leds::clear() {
    fill_solid(keyLeds, MAX_KEY_LEDS, CRGB::Black);
}

void Leds::show() {
    FastLED.show();
}

}  // namespace melophos
