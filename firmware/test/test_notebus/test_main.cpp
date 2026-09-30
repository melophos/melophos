#include <unity.h>

#include "notebus.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static NoteEvent noteOn(uint8_t note) {
    return NoteEvent{0, note, 100, 0, NoteSource::UsbMidi};
}

void test_events_come_out_in_order() {
    NoteBus bus;
    bus.push(noteOn(60));
    bus.push(noteOn(64));
    NoteEvent out;
    TEST_ASSERT_TRUE(bus.pop(out));
    TEST_ASSERT_EQUAL(60, out.note);
    TEST_ASSERT_TRUE(bus.pop(out));
    TEST_ASSERT_EQUAL(64, out.note);
    TEST_ASSERT_FALSE(bus.pop(out));
}

void test_full_bus_drops_and_counts() {
    NoteBus bus;
    // one slot stays empty to tell full from empty
    for (size_t i = 0; i < NoteBus::kCapacity - 1; i++) {
        TEST_ASSERT_TRUE(bus.push(noteOn(60)));
    }
    TEST_ASSERT_FALSE(bus.push(noteOn(61)));
    TEST_ASSERT_EQUAL(1, bus.dropped());
    TEST_ASSERT_EQUAL(NoteBus::kCapacity - 1, bus.size());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_events_come_out_in_order);
    RUN_TEST(test_full_bus_drops_and_counts);
    return UNITY_END();
}
