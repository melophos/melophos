#include <string.h>
#include <unity.h>

#include "audiogate.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

void test_audio_is_refused_on_usb_power_alone_with_a_plain_reason() {
    AudioControl a;
    char reply[300];
    TEST_ASSERT_FALSE(a.request(true, false, reply, sizeof reply));
    TEST_ASSERT_FALSE(a.on());
    TEST_ASSERT_NOT_NULL(strstr(reply, "\"ok\":false"));
    TEST_ASSERT_NOT_NULL(strstr(reply, "DC power inlet"));
    TEST_ASSERT_NOT_NULL(strstr(reply, "too low"));
}

void test_audio_is_allowed_with_the_dc_inlet_and_always_switches_off() {
    AudioControl a;
    char reply[300];
    TEST_ASSERT_TRUE(a.request(true, true, reply, sizeof reply));
    TEST_ASSERT_TRUE(a.on());
    TEST_ASSERT_NOT_NULL(strstr(reply, "\"audio\":\"on\""));
    TEST_ASSERT_TRUE(a.request(false, false, reply, sizeof reply));  // off never needs the inlet
    TEST_ASSERT_FALSE(a.on());
}

void test_losing_the_inlet_switches_audio_off_with_the_reason() {
    AudioControl a;
    char reply[300] = "";
    a.request(true, true, reply, sizeof reply);
    TEST_ASSERT_FALSE(a.poll(true, reply, sizeof reply));  // still powered: nothing happens
    TEST_ASSERT_TRUE(a.on());
    TEST_ASSERT_TRUE(a.poll(false, reply, sizeof reply));
    TEST_ASSERT_FALSE(a.on());
    TEST_ASSERT_NOT_NULL(strstr(reply, "DC power inlet"));
    TEST_ASSERT_FALSE(a.poll(false, reply, sizeof reply));  // told once
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_audio_is_refused_on_usb_power_alone_with_a_plain_reason);
    RUN_TEST(test_audio_is_allowed_with_the_dc_inlet_and_always_switches_off);
    RUN_TEST(test_losing_the_inlet_switches_audio_off_with_the_reason);
    return UNITY_END();
}
