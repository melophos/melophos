#include <unity.h>

#include "../support/fakes.h"
#include "usbhost.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

struct Rig {
    FakeClock clock;
    FakePower power;
    FakeUsbPort port;
    UsbHostFsm fsm{clock, power, port};
    void run(uint32_t ms) {
        for (uint32_t i = 0; i < ms; i++) {
            clock.advance(1);
            fsm.tick();
        }
    }
};

void test_power_on_then_a_keyboard_enumerates() {
    Rig r;
    r.fsm.begin();
    TEST_ASSERT_TRUE(r.power.on);  // the hub powers the keyboard
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Waiting);
    r.fsm.onDeviceAttached();
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Enumerating);
    TEST_ASSERT_EQUAL(1, r.port.enumerations);
    r.fsm.onEnumerated(true, true);
    TEST_ASSERT_TRUE(r.fsm.streaming());
    r.run(60000);  // nothing times out while it streams
    TEST_ASSERT_TRUE(r.fsm.streaming());
}

void test_unplug_and_replug_recovers_without_a_reset() {
    Rig r;
    r.fsm.begin();
    for (int round = 0; round < 20; round++) {
        r.fsm.onDeviceAttached();
        r.fsm.onEnumerated(true, true);
        TEST_ASSERT_TRUE(r.fsm.streaming());
        r.fsm.onDeviceDetached();
        TEST_ASSERT_TRUE(r.fsm.state() == UsbState::PowerCycle);
        TEST_ASSERT_FALSE(r.power.on);
        r.run(UsbHostFsm::kPowerCycleMs);
        TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Waiting);
        TEST_ASSERT_TRUE(r.power.on);
    }
    TEST_ASSERT_EQUAL(20, (int)r.fsm.cycles());
    TEST_ASSERT_EQUAL(20, r.port.releases);
}

void test_a_device_that_never_answers_times_out_and_gets_a_power_cycle() {
    Rig r;
    r.fsm.begin();
    r.fsm.onDeviceAttached();
    r.run(UsbHostFsm::kEnumerateTimeoutMs - 1);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Enumerating);
    r.run(1);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::PowerCycle);
    TEST_ASSERT_FALSE(r.power.on);
    // the off time doubles after a failure: 1000 ms this time
    r.run(999);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::PowerCycle);
    r.run(1);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Waiting);
}

void test_repeated_failures_stop_at_five_and_wait_for_an_unplug() {
    Rig r;
    r.fsm.begin();
    int guard = 0;
    while (r.fsm.state() != UsbState::Rejected && guard++ < 100) {
        r.fsm.onDeviceAttached();
        r.fsm.onEnumerated(false, false);
        r.run(9000);
    }
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Rejected);
    TEST_ASSERT_TRUE(guard <= 6);
    int cyclesBefore = r.fsm.cycles();
    r.run(120000);  // it does not hammer the port
    TEST_ASSERT_EQUAL(cyclesBefore, (int)r.fsm.cycles());
    r.fsm.onDeviceDetached();  // someone unplugs it
    r.run(500);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Waiting);
}

void test_a_non_midi_device_is_rejected_until_unplugged() {
    Rig r;
    r.fsm.begin();
    r.fsm.onDeviceAttached();
    r.fsm.onEnumerated(true, false);  // a mouse
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Rejected);
    TEST_ASSERT_FALSE(r.fsm.streaming());
    r.fsm.onDeviceDetached();
    r.run(500);
    r.fsm.onDeviceAttached();
    r.fsm.onEnumerated(true, true);
    TEST_ASSERT_TRUE(r.fsm.streaming());
}

void test_overcurrent_cuts_power_at_once_and_latches_after_three() {
    Rig r;
    r.fsm.begin();
    r.fsm.onDeviceAttached();
    r.fsm.onEnumerated(true, true);
    r.fsm.onOvercurrent();
    TEST_ASSERT_FALSE(r.power.on);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Overcurrent);
    r.run(UsbHostFsm::kOvercurrentCoolMs - 1);
    TEST_ASSERT_FALSE(r.power.on);
    r.run(1);
    TEST_ASSERT_TRUE(r.power.on);
    r.fsm.onOvercurrent();
    r.run(UsbHostFsm::kOvercurrentCoolMs);
    r.fsm.onOvercurrent();  // the third in a row, no good enumeration between
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Latched);
    r.run(600000);
    TEST_ASSERT_FALSE(r.power.on);  // stays off however long we wait
    r.fsm.clearFault();
    TEST_ASSERT_TRUE(r.power.on);
}

void test_a_good_enumeration_clears_the_overcurrent_count() {
    Rig r;
    r.fsm.begin();
    for (int i = 0; i < 10; i++) {
        r.fsm.onDeviceAttached();
        r.fsm.onEnumerated(true, true);
        r.fsm.onOvercurrent();
        r.run(UsbHostFsm::kOvercurrentCoolMs);
    }
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Waiting);
}

void test_stale_events_are_ignored() {
    Rig r;
    r.fsm.onDeviceAttached();  // before begin
    r.fsm.onEnumerated(true, true);
    r.fsm.onDeviceDetached();
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Off);
    r.fsm.begin();
    r.fsm.onEnumerated(true, true);  // no attach first
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::Waiting);
    r.fsm.onOvercurrent();
    r.fsm.onOvercurrent();
    TEST_ASSERT_FALSE(r.power.on);
}

void test_millisecond_counter_wrap() {
    Rig r;
    r.clock.now = 0xFFFFFFFFu - 1000;
    r.fsm.begin();
    r.fsm.onDeviceAttached();
    r.run(UsbHostFsm::kEnumerateTimeoutMs);
    TEST_ASSERT_TRUE(r.fsm.state() == UsbState::PowerCycle);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_power_on_then_a_keyboard_enumerates);
    RUN_TEST(test_unplug_and_replug_recovers_without_a_reset);
    RUN_TEST(test_a_device_that_never_answers_times_out_and_gets_a_power_cycle);
    RUN_TEST(test_repeated_failures_stop_at_five_and_wait_for_an_unplug);
    RUN_TEST(test_a_non_midi_device_is_rejected_until_unplugged);
    RUN_TEST(test_overcurrent_cuts_power_at_once_and_latches_after_three);
    RUN_TEST(test_a_good_enumeration_clears_the_overcurrent_count);
    RUN_TEST(test_stale_events_are_ignored);
    RUN_TEST(test_millisecond_counter_wrap);
    return UNITY_END();
}
