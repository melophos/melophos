#include "leds.h"

#include <FastLED.h>

#include "melophos_config.h"
#include "render.h"

namespace melophos {

namespace {

CRGB keyLeds[MAX_KEY_LEDS];
#if LAYOUT_FRET_LEDS > 0
CRGB fretLeds[LAYOUT_FRET_LEDS];
#endif
#if LAYOUT_AUX_LEDS > 0 && PIN_LED_AUX >= 0
CRGB auxLeds[LAYOUT_AUX_LEDS];
size_t auxInUse = 0;  // the length in use: only these lights get data in normal running
CLEDController *auxController = nullptr;
#endif

void copy(CRGB *to, size_t n, const Rgb *pixels, size_t count, size_t offset) {
    for (size_t i = 0; i < n; i++) {
        size_t at = offset + i;
        to[i] = at < count ? CRGB(pixels[at].r, pixels[at].g, pixels[at].b) : CRGB::Black;
    }
}

}  // namespace

void Leds::begin() {
#if LAYOUT_AUX_LEDS > 0 && PIN_LED_AUX >= 0
    auxInUse = LAYOUT_AUX_LEDS;  // until the stored length is read, everything is blanked at the maximum
#endif
    FastLED.addLeds<WS2812B, PIN_LED_KEYS, GRB>(keyLeds, MAX_KEY_LEDS);
#if LAYOUT_FRET_LEDS > 0
    FastLED.addLeds<WS2812B, PIN_LED_FRETS, GRB>(fretLeds, LAYOUT_FRET_LEDS);
#endif
#if LAYOUT_AUX_LEDS > 0 && PIN_LED_AUX >= 0
    // registered at the MAXIMUM length so that begin() can blank all of it, then cut down to the length in use
    auxController = &FastLED.addLeds<WS2812B, PIN_LED_AUX, GRB>(auxLeds, LAYOUT_AUX_LEDS);
#endif
    // the renderer already applies master brightness and the current ceiling to the whole frame.
    // FastLED keeps its own limit as a last resort. Read in its source (power_mgt.cpp.hpp): it sums the power of ALL its
    // controllers, charges a 250 mW baseline for the MCU (50 mA at 5 V on the ESP32) against the same budget and
    // uses its own lighter per-channel figures and when over it lowers the global brightness, which would change
    // lights without regard for the flash limits. So it must never engage while the guard works: its budget is the
    // guard's figure plus the 100 mA margin plus its MCU baseline. It then acts only if the guard has failed
    FastLED.setMaxPowerInMilliWatts(5u * (kLedCurrentCeilingMa + 100u) + 250u);
    FastLED.setBrightness(255);
    fill_solid(keyLeds, MAX_KEY_LEDS, CRGB::Black);
#if LAYOUT_FRET_LEDS > 0
    fill_solid(fretLeds, LAYOUT_FRET_LEDS, CRGB::Black);
#endif
#if LAYOUT_AUX_LEDS > 0 && PIN_LED_AUX >= 0
    fill_solid(auxLeds, LAYOUT_AUX_LEDS, CRGB::Black);
#endif
    // blank the MAXIMUM length of every output once, whatever length is in use: a strip that was longer on the last run
    // (the length is changed and the hub restarted) would otherwise hold its last colours past the new length, outside
    // the guard. The aux output is cut down to the length in use later, by setAuxInUse
    FastLED.show();
}

void Leds::setAuxInUse(size_t length) {
#if LAYOUT_AUX_LEDS > 0 && PIN_LED_AUX >= 0
    auxInUse = length > LAYOUT_AUX_LEDS ? LAYOUT_AUX_LEDS : length;
    if (auxController != nullptr) {
        auxController->setLeds(auxLeds, (int)auxInUse);
    }
#else
    (void)length;
#endif
}

void Leds::show(const Rgb *pixels, size_t count) {
    copy(keyLeds, MAX_KEY_LEDS, pixels, count, 0);
#if LAYOUT_FRET_LEDS > 0
    copy(fretLeds, LAYOUT_FRET_LEDS, pixels, count, MAX_KEY_LEDS);
#endif
#if LAYOUT_AUX_LEDS > 0 && PIN_LED_AUX >= 0
    copy(auxLeds, auxInUse, pixels, count, MAX_KEY_LEDS + LAYOUT_FRET_LEDS);
#endif
    FastLED.show();
}

}  // namespace melophos
