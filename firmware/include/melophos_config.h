#pragma once

#define MELOPHOS_FIRMWARE_VERSION "0.1.0"
// the integer the update check compares, raised with every release. 0.1.0 is 100
#define MELOPHOS_VERSION_NUMBER 100

// pins for the ESP32-S3-WROOM-1 on the hub board rev A. The source is the board's module pin table, kept with
// the board design and copied into test/data/hub-pins.md. test_pins compares this header with that copy line for line. Each board
// environment in platformio.ini overrides what differs (the classic ESP32 bring-up board).
//
// The classic ESP32 bring-up board (MELOPHOS_HUB_REV below 0) has its own pins and power rule, set by its
// environment in platformio.ini: no flash pins, not the console UART, SENSE_5V on an ADC1 pin and a bench supply.
#ifndef MELOPHOS_BENCH_SUPPLY
#define MELOPHOS_BENCH_SUPPLY 0
#endif
// GPIO 35, 36 and 37 belong to the module's PSRAM and must never be driven. GPIO 19 and 20 are the host
// USB data pair and glitch at power-up, which is harmless there.

// LED data goes through a 74HCT125 with its enables tied to ground. GPIO4 and GPIO5 have no pull inside the
// module at reset: the board's 10 k pull-downs hold the strip's data lines low. The LED part's input high
// level is 0.65 x VDD and the 74HCT125 swings to the 5 V rail, so the shifter meets it
#ifndef PIN_LED_KEYS
#define PIN_LED_KEYS 4
#endif
#ifndef PIN_LED_FRETS
#define PIN_LED_FRETS 5
#endif
// the third output, LED_AUX, on connector J14 (the pin order of the keys and frets connectors), through the same
// level shifter. A 10 k pull-down holds it low at reset. Awaits a board
#ifndef PIN_LED_AUX
#define PIN_LED_AUX 38
#endif

// the LED current ceiling is kLedCurrentCeilingMa in lib/practice/render.h (2700 mA, set by the board's
// power budget). The output guard applies it last and FastLED keeps it as a second guard, see leds.cpp
// master level 0 to 255 before the ceiling. Half is bright enough in a lit room
// and keeps the usual frame near 100 mA
#define LED_MASTER_BRIGHTNESS 128

#define MAX_KEY_LEDS 180
#define MAX_FRET_LEDS 150
// the third output (LED_AUX, connector J14): the longest strip the hub supports, a hard maximum. 150 is a
// placeholder until the owner gives the real figure. kAuxLedsMax in lib/practice/render.h is the same figure and
// test_pins checks they agree. The length in use is a stored setting (`aux length <n>`), default 60
#define MAX_AUX_LEDS 150

// the hub board drives three LED outputs. The classic ESP32 bring-up board drives the key strip alone. The output
// guard sees them as one frame (keys, then frets, then aux): the current ceiling is a total over all of them and
// the flash limits count across them together. Everything about the second and third output awaits a board.
#if defined(MELOPHOS_HUB_REV) && MELOPHOS_HUB_REV < 0
#define LAYOUT_FRET_LEDS 0
#define LAYOUT_AUX_LEDS 0
#else
#define LAYOUT_FRET_LEDS MAX_FRET_LEDS
#define LAYOUT_AUX_LEDS MAX_AUX_LEDS
#endif

// audio converter, I2S. MCLK 7 is an output, DIN is driven by the converter
#ifndef PIN_I2S_MCLK
#define PIN_I2S_MCLK 7
#endif
#ifndef PIN_I2S_BCLK
#define PIN_I2S_BCLK 15
#endif
#ifndef PIN_I2S_WS
#define PIN_I2S_WS 16
#endif
#ifndef PIN_I2S_DIN
#define PIN_I2S_DIN 17
#endif

// MIDI. TX is held high through R43 at reset but may put a 60 microsecond low pulse on the output as the
// module powers up (a stray start bit at the receiver, an estimate). setup() drives it high first of all
#ifndef PIN_MIDI_RX
#define PIN_MIDI_RX 18
#endif
#ifndef PIN_MIDI_TX
#define PIN_MIDI_TX 8
#endif

// keyboard host port. HOST_EN is the TPS2553 enable, active high and low at reset so the port is off until
// the firmware turns it on. HOST_FAULT is the switch's fault output: HIGH means no fault. CC1 and CC2
// are analogue inputs
#ifndef PIN_HOST_EN
#define PIN_HOST_EN 9
#endif
#ifndef PIN_HOST_FAULT
#define PIN_HOST_FAULT 10
#endif
#ifndef PIN_HOST_CC1
#define PIN_HOST_CC1 2
#endif
#ifndef PIN_HOST_CC2
#define PIN_HOST_CC2 6
#endif

#ifndef PIN_I2C_SDA
#define PIN_I2C_SDA 11
#endif
#ifndef PIN_I2C_SCL
#define PIN_I2C_SCL 12
#endif
#ifndef PIN_STATUS_LED
#define PIN_STATUS_LED 21
#endif

// SENSE_5V reads half of the 5 V rail (R4 and R5), as an analogue level. The DC inlet is present when the
// rail is above about 3.5 V, which is 1.75 V on the pin (1750 mV)
#ifndef PIN_SENSE_5V
#define PIN_SENSE_5V 1
#endif
#define SENSE_5V_THRESHOLD_MV 1750
// whether the DC inlet is present is decided in lib/inlet/inlet.h from this pin (and SENSE_VIN where fitted).
// The table's 3.5 V threshold only says the rail is present. The inlet rule latches at start-up from a dark
// rail of 4.4 V or more and drops only under 3.0 V. Its SENSE_VIN thresholds are PROVISIONAL.

// the rotary encoder: two phases and a push switch, each a 2.7 k pull-up on the contact to +3V3_MOD, 10 k in series from the contact to the pin and 10 nF on the pin. The
// switch reads LOW while pressed. All three are inputs. Awaits a board
#ifndef PIN_ENC_A
#define PIN_ENC_A 47
#endif
#ifndef PIN_ENC_B
#define PIN_ENC_B 48
#endif
#ifndef PIN_ENC_SW
#define PIN_ENC_SW 14
#endif
#define ENC_SW_ACTIVE_LOW 1

// the buzzer: GPIO 40 through a transistor from the 5 V rail, held off at reset by a 10 k. It adds 5 mA. The board is
// not driven on this pin during boot and has no JTAG as built (see below), so nothing clicks. MELOPHOS_JTAG is for a
// board that does have JTAG on GPIO 39 to 42 (a development board wired for it or a hub with the one-time JTAG fuse
// burnt): a build for such a board defines it as 1 and then the firmware never touches GPIO 40, which would be
// JTAG's data out there. The rev A hub as built leaves it at 0. The buzzer is silent unless a stored setting turns
// sound on (lib/buzzer). Awaits a board
#ifndef PIN_BUZZER
#define PIN_BUZZER 40
#endif
#ifndef MELOPHOS_JTAG
#define MELOPHOS_JTAG 0
#endif

// the spare header J15 (pin 1 ground, pin 2 3.3 V, then these three): GPIO 39, 41 and 42 are spare pins on the
// hub, not JTAG, because the board has no JTAG as built. The default JTAG source of the ESP32-S3 is its USB
// controller, whose pins the keyboard host port uses and GPIO 3 (JTAG_SEL, held low by R67) is ignored unless a
// one-time fuse is burnt. Debugging is by the UART bridge. The firmware leaves the three pins untouched unless a build
// defines MELOPHOS_CLAIM_SPARE_PINS as 1. The names below are the nets' names in the pin table. Nothing claims them
// today. (This rests on one reading of Espressif's data sheet until a second confirms it)
#define PIN_JTAG_TCK 39
#define PIN_JTAG_TDI 41
#define PIN_JTAG_TMS 42
#ifndef MELOPHOS_CLAIM_SPARE_PINS
#define MELOPHOS_CLAIM_SPARE_PINS 0
#endif

// SENSE_VIN: the second sense point, on the jack ahead of the or-ing. It is read as a LOGIC input (GPIO 13 is on
// the second ADC unit, which cannot be used while Wi-Fi runs): a divider of 47 k over 68 k with a 10 k series
// resistor to the pin. The truth table is in lib/inlet/inlet.h. The rev A hub environments define
// SENSE_VIN_FITTED as 1. The classic ESP32 bring-up board does not have it
#ifndef PIN_SENSE_VIN
#define PIN_SENSE_VIN 13
#endif
#ifndef SENSE_VIN_FITTED
#define SENSE_VIN_FITTED 0
#endif

// the console is UART0 through the CH340C bridge, on its own connector. The USB serial of the chip is not
// the console, because the keyboard host takes the chip's only USB PHY
#define PIN_UART_TX 43
#define PIN_UART_RX 44

// nothing about the owner's network is compiled in. Wi-Fi, the broker, the device
// identity and the certificate authority are provisioned into the hub's storage
// (lib/identity). The only settings a build can carry are the update ones, in
// include/secrets.h, which is never committed. See melophos_config.h below.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#define MELOPHOS_NO_SECRETS 1
#endif

// Wi-Fi updates are OFF unless a build defines MELOPHOS_ENABLE_OTA. Turning them
// on needs real values in secrets.h: the public half of the signing key as
// UPDATE_PUBKEY_BYTES (32 comma separated bytes), UPDATE_MANIFEST_URL,
// UPDATE_IMAGE_URL and the server's CA certificate as UPDATE_CA_CERT. A build
// that enables updates with placeholders does not compile and neither does a release
// build that enables them with placeholders.
#if defined(MELOPHOS_ENABLE_OTA)
#if defined(MELOPHOS_NO_SECRETS) || (MELOPHOS_SECRETS_ARE_PLACEHOLDER)
#error "MELOPHOS_ENABLE_OTA needs real update settings in include/secrets.h (public key, URLs and CA certificate)"
#endif
#ifndef UPDATE_PUBKEY_BYTES
#error "secrets.h must define UPDATE_PUBKEY_BYTES"
#endif
#endif

