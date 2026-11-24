// the classic ESP32 bring-up board's own pin set and power rule. Built by `pio test -e native-bringup`, which
// passes the same flags as the esp32-bringup environment. The hub's table is checked by test_pins.
#include <unity.h>

#include "melophos_config.h"

void setUp() {}
void tearDown() {}

static bool flashPin(int p) {
    return p >= 6 && p <= 11;  // GPIO 6 to 11 drive the flash chip on classic ESP32 modules
}

void test_the_bring_up_board_uses_no_flash_pin_and_not_the_console_uart() {
    const int used[] = {PIN_LED_KEYS, PIN_LED_FRETS, PIN_I2S_BCLK, PIN_I2S_WS, PIN_I2S_DIN, PIN_MIDI_RX, PIN_MIDI_TX,
                        PIN_SENSE_5V, PIN_STATUS_LED, PIN_I2C_SDA, PIN_I2C_SCL};
    for (int p : used) {
        TEST_ASSERT_FALSE_MESSAGE(flashPin(p), "a flash pin is used");
        TEST_ASSERT_TRUE_MESSAGE(p != 1 && p != 3, "the console UART0 is used");  // GPIO 1 and 3 are the console here
        TEST_ASSERT_TRUE(p >= 0 && p <= 39);
    }
    // the S3 hub's pins that do not exist here are switched off, not left on the flash pins
    TEST_ASSERT_TRUE(PIN_HOST_EN < 0 && PIN_HOST_FAULT < 0 && PIN_I2S_MCLK < 0);
    TEST_ASSERT_EQUAL(19, PIN_MIDI_TX);
    TEST_ASSERT_EQUAL(0, SENSE_VIN_FITTED);
}

void test_the_sense_pin_is_an_adc1_input_that_works_with_wifi_and_power_is_a_bench_supply() {
    TEST_ASSERT_TRUE_MESSAGE(PIN_SENSE_5V >= 32 && PIN_SENSE_5V <= 39, "SENSE_5V must be on ADC1 (GPIO 32 to 39): ADC2 cannot run with Wi-Fi");
    // a development kit powers the strip from a bench supply: there is no inlet to sense, so it counts as present
    TEST_ASSERT_EQUAL(1, MELOPHOS_BENCH_SUPPLY);
}

void test_the_bring_up_board_has_none_of_the_new_hub_parts_and_one_output() {
    TEST_ASSERT_TRUE(PIN_LED_AUX < 0 && PIN_BUZZER < 0 && PIN_ENC_A < 0 && PIN_ENC_B < 0 && PIN_ENC_SW < 0);
    TEST_ASSERT_EQUAL(0, LAYOUT_FRET_LEDS);
    TEST_ASSERT_EQUAL(0, LAYOUT_AUX_LEDS);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_the_bring_up_board_uses_no_flash_pin_and_not_the_console_uart);
    RUN_TEST(test_the_sense_pin_is_an_adc1_input_that_works_with_wifi_and_power_is_a_bench_supply);
    RUN_TEST(test_the_bring_up_board_has_none_of_the_new_hub_parts_and_one_output);
    return UNITY_END();
}
