#include <unity.h>

#include "keymap.h"

using namespace melophos;

static KeyboardProfile piano88PerKey() {
    return KeyboardProfile{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false};
}

static KeyboardProfile piano88Strip144() {
    return KeyboardProfile{21, 108, 23.5f, LedLayout::Strip, 144.0f, 0, false};
}

void setUp() {}
void tearDown() {}

void test_black_keys() {
    TEST_ASSERT_FALSE(isBlackKey(60));  // C4
    TEST_ASSERT_TRUE(isBlackKey(61));   // C#4
    TEST_ASSERT_FALSE(isBlackKey(64));  // E4
    TEST_ASSERT_TRUE(isBlackKey(70));   // A#4
}

void test_per_key_maps_every_key_once() {
    KeyboardProfile p = piano88PerKey();
    TEST_ASSERT_EQUAL(88, ledCount(p));
    TEST_ASSERT_EQUAL(0, ledIndexForNote(p, 21));
    TEST_ASSERT_EQUAL(39, ledIndexForNote(p, 60));
    TEST_ASSERT_EQUAL(87, ledIndexForNote(p, 108));
}

void test_out_of_range_notes_are_rejected() {
    KeyboardProfile p = piano88PerKey();
    TEST_ASSERT_EQUAL(-1, ledIndexForNote(p, 20));
    TEST_ASSERT_EQUAL(-1, ledIndexForNote(p, 109));
}

void test_strip_144_spans_the_keybed() {
    KeyboardProfile p = piano88Strip144();
    // 52 white keys x 23.5 mm = 1222 mm, at 6.94 mm per LED that is 176 LEDs
    TEST_ASSERT_EQUAL(176, ledCount(p));
    TEST_ASSERT_EQUAL(1, ledIndexForNote(p, 21));
    TEST_ASSERT_EQUAL(174, ledIndexForNote(p, 108));
}

void test_strip_indexes_rise_with_pitch() {
    KeyboardProfile p = piano88Strip144();
    int previous = -1;
    for (int note = 21; note <= 108; note++) {
        int index = ledIndexForNote(p, (uint8_t)note);
        TEST_ASSERT_TRUE(index > previous);
        previous = index;
    }
}

void test_reversed_mirrors_the_bar() {
    KeyboardProfile p = piano88PerKey();
    p.reversed = true;
    TEST_ASSERT_EQUAL(87, ledIndexForNote(p, 21));
    TEST_ASSERT_EQUAL(0, ledIndexForNote(p, 108));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_black_keys);
    RUN_TEST(test_per_key_maps_every_key_once);
    RUN_TEST(test_out_of_range_notes_are_rejected);
    RUN_TEST(test_strip_144_spans_the_keybed);
    RUN_TEST(test_strip_indexes_rise_with_pitch);
    RUN_TEST(test_reversed_mirrors_the_bar);
    return UNITY_END();
}
