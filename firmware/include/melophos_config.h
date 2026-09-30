#pragma once

#define MELOPHOS_FIRMWARE_VERSION "0.1.0"

// Defaults match the ESP32-S3-DevKitC-1 and the rev A hub. Each board
// environment in platformio.ini overrides what differs.

// LED data goes through a 74AHCT125: WS2812B needs a 0.7 x VDD high level,
// which 3.3 V logic does not reliably reach on a 5 V supply
#ifndef PIN_LED_KEYS
#define PIN_LED_KEYS 4
#endif
#ifndef PIN_LED_FRETS
#define PIN_LED_FRETS 5
#endif

// stops a full-white frame browning out the supply
#define LED_MAX_MILLIAMPS 3000
#define LED_BRIGHTNESS 64

#define MAX_KEY_LEDS 180
#define MAX_FRET_LEDS 150

#ifndef PIN_I2S_BCLK
#define PIN_I2S_BCLK 15
#endif
#ifndef PIN_I2S_WS
#define PIN_I2S_WS 16
#endif
#ifndef PIN_I2S_DIN
#define PIN_I2S_DIN 17
#endif

#ifndef PIN_MIDI_RX
#define PIN_MIDI_RX 18
#endif
#ifndef PIN_MIDI_TX
#define PIN_MIDI_TX 8
#endif
