// compares include/melophos_config.h with the hub board's pin table line for line. The table is copied to
// test/data/hub-pins.md because the hardware file lives on another machine. If they disagree the
// hardware file wins: update the copy and the header together.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include <map>
#include <string>
#include <vector>

#include "melophos_config.h"
#include "render.h"

void setUp() {}
void tearDown() {}

struct Row {
    std::string pins, gpio, net, dir;
};

static std::vector<Row> table() {
    FILE *f = fopen("test/data/hub-pins.md", "rb");
    TEST_ASSERT_NOT_NULL_MESSAGE(f, "test/data/hub-pins.md");
    char line[600];
    std::vector<Row> rows;
    while (fgets(line, sizeof line, f)) {
        std::string l = line;
        if (l.compare(0, 1, "|") != 0 || l.find("---") != std::string::npos || l.find("Module pin") != std::string::npos) {
            continue;
        }
        std::vector<std::string> cell;
        size_t at = 1;
        for (;;) {
            size_t bar = l.find('|', at);
            if (bar == std::string::npos) {
                break;
            }
            std::string c = l.substr(at, bar - at);
            size_t a = c.find_first_not_of(' '), b = c.find_last_not_of(' ');
            cell.push_back(a == std::string::npos ? "" : c.substr(a, b - a + 1));
            at = bar + 1;
        }
        if (cell.size() >= 4) {
            rows.push_back(Row{cell[0], cell[1], cell[2], cell[3]});
        }
    }
    fclose(f);
    return rows;
}

// the net in the table and the macro that must equal its GPIO
static const std::map<std::string, int> kMacros = {
    {"SENSE_5V", PIN_SENSE_5V},   {"HOST_CC1", PIN_HOST_CC1},     {"LED_KEYS", PIN_LED_KEYS},   {"LED_FRETS", PIN_LED_FRETS},
    {"HOST_CC2", PIN_HOST_CC2},   {"I2S_MCLK", PIN_I2S_MCLK},     {"MIDI_TX", PIN_MIDI_TX},     {"HOST_EN", PIN_HOST_EN},
    {"HOST_FAULT", PIN_HOST_FAULT}, {"I2C_SDA", PIN_I2C_SDA},     {"I2C_SCL", PIN_I2C_SCL},     {"I2S_BCLK", PIN_I2S_BCLK},
    {"I2S_WS", PIN_I2S_WS},       {"I2S_DIN", PIN_I2S_DIN},       {"MIDI_RX", PIN_MIDI_RX},     {"STATUS_LED", PIN_STATUS_LED},
    {"UART_TX", PIN_UART_TX},     {"UART_RX", PIN_UART_RX},     {"SENSE_VIN", PIN_SENSE_VIN},
    {"LED_AUX", PIN_LED_AUX},     {"BUZZER", PIN_BUZZER},         {"ENC_A", PIN_ENC_A},         {"ENC_B", PIN_ENC_B},
    {"ENC_SW", PIN_ENC_SW},       {"JTAG_TCK", PIN_JTAG_TCK},     {"JTAG_TDI", PIN_JTAG_TDI},   {"JTAG_TMS", PIN_JTAG_TMS}};

void test_every_pin_in_the_header_is_the_tables_gpio_for_that_net() {
    auto rows = table();
    TEST_ASSERT_TRUE(rows.size() > 30);
    for (auto &m : kMacros) {
        bool found = false;
        for (auto &r : rows) {
            if (r.net == m.first) {
                found = true;
                char msg[80];
                snprintf(msg, sizeof msg, "%s: header %d, table %s", m.first.c_str(), m.second, r.gpio.c_str());
                TEST_ASSERT_EQUAL_MESSAGE(atoi(r.gpio.c_str()), m.second, msg);
            }
        }
        TEST_ASSERT_TRUE_MESSAGE(found, m.first.c_str());
    }
}

void test_every_assigned_gpio_in_the_table_has_a_macro_and_the_directions_agree() {
    auto rows = table();
    int checked = 0;
    for (auto &r : rows) {
        bool digits = !r.gpio.empty() && r.gpio[0] >= '0' && r.gpio[0] <= '9' && r.gpio.find(' ') == std::string::npos;
        if (!digits || r.net == "none" || r.net.empty()) {
            continue;
        }
        if (kMacros.count(r.net)) {
            checked++;
        } else {
            // the rest are strapping, USB data and test pads: the firmware does not assign them
            const char *unassigned[] = {"BOOT", "JTAG_SEL", "HOST_DN", "HOST_DP"};
            bool ok = false;
            for (auto u : unassigned) {
                ok = ok || r.net == u;
            }
            TEST_ASSERT_TRUE_MESSAGE(ok, ("a table net with no macro: " + r.net).c_str());
        }
    }
    TEST_ASSERT_EQUAL((int)kMacros.size(), checked);
    // the directions the firmware relies on
    for (auto &r : rows) {
        if (r.net == "HOST_EN") {
            TEST_ASSERT_NOT_NULL(strstr(r.dir.c_str(), "active high"));
        }
        if (r.net == "SENSE_5V") {
            TEST_ASSERT_NOT_NULL(strstr(r.dir.c_str(), "analogue"));
        }
    }
}

void test_no_two_signals_share_a_gpio_and_the_psram_pins_are_never_used() {
    std::map<int, std::string> used;
    for (auto &m : kMacros) {
        TEST_ASSERT_TRUE_MESSAGE(!used.count(m.second), m.first.c_str());
        used[m.second] = m.first;
        TEST_ASSERT_TRUE_MESSAGE(m.second < 35 || m.second > 37, ("PSRAM pin used: " + m.first).c_str());  // 35, 36 and 37 are the module's PSRAM
        TEST_ASSERT_TRUE(m.second != 0 && m.second != 3 && m.second != 45 && m.second != 46);  // strapping pins
    }
    TEST_ASSERT_EQUAL_STRING("SENSE_VIN", used[13].c_str());  // and nothing else may take it
}

void test_gpio_13_is_sense_vin_a_logic_input() {
    auto rows = table();
    bool found = false;
    for (auto &r : rows) {
        if (r.gpio == "13") {
            found = true;
            TEST_ASSERT_EQUAL_STRING("SENSE_VIN", r.net.c_str());
            TEST_ASSERT_NOT_NULL(strstr(r.dir.c_str(), "logic"));  // not an ADC input
        }
    }
    TEST_ASSERT_TRUE(found);
    TEST_ASSERT_EQUAL(13, PIN_SENSE_VIN);
}

void test_the_sense_thresholds_follow_the_tables_notes() {
    TEST_ASSERT_EQUAL(1750, SENSE_5V_THRESHOLD_MV);   // 3.5 V on the rail is 1.75 V on the pin
}

// the second issue of the schematic (22 November 2026): the encoder, the third LED output, the buzzer and J15.
// Everything here awaits a board
void test_the_new_pins_have_the_directions_the_firmware_relies_on() {
    auto rows = table();
    int seen = 0;
    for (auto &r : rows) {
        if (r.net == "LED_AUX" || r.net == "BUZZER") {
            TEST_ASSERT_NOT_NULL_MESSAGE(strstr(r.dir.c_str(), "out"), r.net.c_str());
            seen++;
        }
        if (r.net == "ENC_A" || r.net == "ENC_B" || r.net == "ENC_SW") {
            TEST_ASSERT_EQUAL_STRING_MESSAGE("in", r.dir.c_str(), r.net.c_str());
            seen++;
        }
    }
    TEST_ASSERT_EQUAL(5, seen);
    TEST_ASSERT_EQUAL(1, ENC_SW_ACTIVE_LOW);  // the switch reads low while pressed
}

void test_the_spare_pins_are_untouched_and_the_hub_as_built_has_no_jtag_claim() {
    TEST_ASSERT_EQUAL(40, PIN_BUZZER);
    TEST_ASSERT_EQUAL(0, MELOPHOS_JTAG);  // the hub as built has no JTAG: only a build for a board that does sets 1 and then the firmware leaves GPIO 40 alone
    // J15: GPIO 39, 41 and 42 are spare pins and belong to nothing unless a build claims them
    TEST_ASSERT_EQUAL(0, MELOPHOS_CLAIM_SPARE_PINS);
    const int spare[] = {39, 41, 42};
    for (int g : spare) {
        for (auto &m : kMacros) {
            if (m.second == g) {
                TEST_ASSERT_TRUE_MESSAGE(m.first.compare(0, 5, "JTAG_") == 0, ("a feature uses a spare pin: " + m.first).c_str());
            }
        }
    }
}

void test_the_three_outputs_add_up_to_the_guards_capacity() {
    TEST_ASSERT_EQUAL((int)melophos::kGuardLeds, MAX_KEY_LEDS + LAYOUT_FRET_LEDS + LAYOUT_AUX_LEDS);
    TEST_ASSERT_EQUAL(180 + 150 + 150, MAX_KEY_LEDS + MAX_FRET_LEDS + MAX_AUX_LEDS);
    TEST_ASSERT_EQUAL((int)melophos::kAuxLedsMax, MAX_AUX_LEDS);  // one maximum for the third output, in both places
    TEST_ASSERT_TRUE(melophos::kAuxLedsDefault <= melophos::kAuxLedsMax);
    TEST_ASSERT_TRUE(PIN_LED_AUX != PIN_LED_KEYS && PIN_LED_AUX != PIN_LED_FRETS);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_every_pin_in_the_header_is_the_tables_gpio_for_that_net);
    RUN_TEST(test_every_assigned_gpio_in_the_table_has_a_macro_and_the_directions_agree);
    RUN_TEST(test_no_two_signals_share_a_gpio_and_the_psram_pins_are_never_used);
    RUN_TEST(test_gpio_13_is_sense_vin_a_logic_input);
    RUN_TEST(test_the_sense_thresholds_follow_the_tables_notes);
    RUN_TEST(test_the_new_pins_have_the_directions_the_firmware_relies_on);
    RUN_TEST(test_the_spare_pins_are_untouched_and_the_hub_as_built_has_no_jtag_claim);
    RUN_TEST(test_the_three_outputs_add_up_to_the_guards_capacity);
    return UNITY_END();
}
