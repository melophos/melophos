#include <unity.h>

#include <vector>

#include "../support/fakes.h"
#include "audiogate.h"
#include "inlet.h"
#include "outputguard.h"
#include "usbhost.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

// the schematic's figures: the pin reads half the rail
static uint16_t pin(double railV) {
    return (uint16_t)(railV * 1000 / 2);
}

void test_the_inlet_is_latched_at_start_up_from_a_dark_rail_of_4_4_volts_or_more() {
    for (double v : {4.69, 5.0, 5.25, 4.4}) {  // DC inlet, LEDs dark; 4.4 V is the threshold itself
        InletSense s;
        s.begin(pin(v), -1);
        TEST_ASSERT_TRUE_MESSAGE(s.present(), "a good inlet was read as absent");
    }
    InletSense usb;
    usb.begin(pin(1.24), -1);  // USB-C alone at 25 C: at most 1.24 V on the rail
    TEST_ASSERT_FALSE(usb.present());
    InletSense under;
    under.begin(pin(4.39), -1);  // just under: the rail is not a good one, so no inlet is claimed
    TEST_ASSERT_FALSE(under.present());
}

void test_a_loaded_rail_never_reads_as_the_inlet_gone_and_a_collapsed_one_does() {
    InletSense s;
    s.begin(pin(5.0), -1);
    // the rail sags under full load to 4.33 V (2.165 V on the pin): still present
    for (int i = 0; i < 1000; i++) {
        s.update(pin(4.33), -1, false);
        TEST_ASSERT_TRUE(s.present());
    }
    s.update(pin(3.2), -1, false);  // a brown-out that has not collapsed it
    TEST_ASSERT_TRUE(s.present());
    s.update(pin(3.0), -1, false);  // 3.0 V exactly: not under
    TEST_ASSERT_TRUE(s.present());
    s.update(pin(2.98), -1, false);
    TEST_ASSERT_FALSE(s.present());
    // a loaded rail cannot bring it back and neither can a dark rail that is not good enough
    s.update(pin(4.33), -1, false);
    TEST_ASSERT_FALSE(s.present());
    s.update(pin(4.33), -1, true);  // dark but under 4.4 V
    TEST_ASSERT_FALSE(s.present());
    s.update(pin(4.7), -1, true);  // dark and good: the inlet is back
    TEST_ASSERT_TRUE(s.present());
}

void test_the_sense_vin_truth_table_with_a_logic_input() {
    // the divider: 47 k over 68 k, the pin sees 0.5913 of the jack
    TEST_ASSERT_INT_WITHIN(5, 2660, (int)(4500 * 68 / 115));  // 4.50 V in
    TEST_ASSERT_INT_WITHIN(5, 2810, (int)(4750 * 68 / 115));
    TEST_ASSERT_INT_WITHIN(5, 2960, (int)(5000 * 68 / 115));
    TEST_ASSERT_INT_WITHIN(5, 3100, (int)(5250 * 68 / 115));
    // low and a dead rail: no inlet (USB alone or a reversed plug the board blocks)
    InletSense a;
    a.begin(pin(0.9), 0);
    TEST_ASSERT_TRUE(a.state() == InletState::Absent);
    // high and a good dark rail: present
    InletSense b;
    b.begin(pin(4.8), 1);
    TEST_ASSERT_TRUE(b.present());
    TEST_ASSERT_TRUE(b.usesVin());
    // high and a rail under 3.0 V: over-voltage lockout and it is not "present"
    InletSense c;
    c.begin(pin(2.0), 1);
    TEST_ASSERT_TRUE(c.state() == InletState::OverVoltage);
    TEST_ASSERT_FALSE(c.present());
    c.update(pin(2.0), 1, true);
    TEST_ASSERT_TRUE(c.state() == InletState::OverVoltage);
    c.update(pin(0.5), 0, true);  // the lockout clears when the jack goes away
    TEST_ASSERT_TRUE(c.state() == InletState::Absent);
    // in the undefined band the rail decides: a low reading with a 4.7 V rail is present
    InletSense d;
    d.begin(pin(4.7), 0);
    TEST_ASSERT_TRUE(d.present());
    // a loaded rail at 4.33 V with the jack high: still present
    InletSense e;
    e.begin(pin(4.8), 1);
    for (int i = 0; i < 100; i++) {
        e.update(pin(4.33), 1, false);
        TEST_ASSERT_TRUE(e.present());
    }
    // the same loaded rail but the jack reads LOW: a good inlet reads high, so there is none
    e.update(pin(4.33), 0, false);
    TEST_ASSERT_FALSE(e.present());
    // high with a sagging rail between the two limits changes nothing either way
    InletSense f;
    f.begin(pin(4.8), 1);
    f.update(pin(3.5), 1, false);
    TEST_ASSERT_TRUE(f.present());
    InletSense g;
    g.begin(pin(0.9), 0);
    g.update(pin(3.5), 1, true);
    TEST_ASSERT_FALSE(g.present());
    // not fitted: the rail rule alone
    InletSense r;
    r.begin(pin(5.0), -1);
    TEST_ASSERT_FALSE(r.usesVin());
    TEST_ASSERT_TRUE(r.present());
}

// what an absent inlet does: no audio, the keyboard port off, the LEDs held to nothing
void test_without_the_inlet_audio_is_refused_the_keyboard_port_is_off_and_the_strip_is_dark() {
    InletSense inlet;
    inlet.begin(pin(0.9), -1);
    TEST_ASSERT_FALSE(inlet.present());
    AudioControl audio;
    char reply[300];
    TEST_ASSERT_FALSE(audio.request(true, inlet.present(), reply, sizeof reply));
    FakeClock clock;
    FakePower power;
    FakeUsbPort port;
    UsbHostFsm fsm(clock, power, port);
    fsm.begin();
    TEST_ASSERT_TRUE(power.on);
    fsm.setPowerAllowed(inlet.present());  // the hub applies the inlet to the port
    TEST_ASSERT_FALSE(power.on);
    TEST_ASSERT_TRUE(fsm.state() == UsbState::Off);
    fsm.onDeviceAttached();
    for (int i = 0; i < 100; i++) {
        clock.advance(100);
        fsm.tick();
    }
    TEST_ASSERT_FALSE(power.on);  // it never switches itself back on
    fsm.begin();                   // even a direct begin is refused
    TEST_ASSERT_FALSE(power.on);
    // the strip has no supply: the ceiling is 0, so every frame is dark
    FakeLedSink sink;
    OutputGuard guard(clock, sink);
    guard.setSupplyCeiling(inlet.present() ? 2700 : 0);
    Rgb frame[40];
    for (auto &p : frame) {
        p = Rgb{255, 150, 0};
    }
    guard.show(frame, 40);
    for (auto &p : sink.last) {
        TEST_ASSERT_EQUAL(0, p.r | p.g | p.b);
    }
    // the inlet arrives: the port may start again
    inlet.update(pin(4.8), -1, true);
    TEST_ASSERT_TRUE(inlet.present());
    fsm.setPowerAllowed(true);
    TEST_ASSERT_TRUE(power.on);
    TEST_ASSERT_TRUE(fsm.state() == UsbState::Waiting);
}

// a flapping reading cannot flap the ceiling: absent for at least a second, back only after 500 ms of steady reading
void test_the_gate_holds_absent_for_a_second_and_wants_a_steady_reading_to_come_back() {
    InletGate g;
    TEST_ASSERT_TRUE(g.step(true, 0));  // the first reading is believed
    TEST_ASSERT_FALSE(g.step(false, 100));  // dropped: absent at once
    for (uint32_t t = 100; t < 1090; t += 10) {
        TEST_ASSERT_FALSE_MESSAGE(g.step(true, t + 10), "back inside the hold");  // present again at once, still held
    }
    // the hold is over at 1100 and the reading has been steady for 1000 ms: back
    TEST_ASSERT_TRUE(g.step(true, 1110));
    // a reading that breaks restarts the 500 ms
    g.step(false, 1200);
    uint32_t t = 2300;
    TEST_ASSERT_FALSE(g.step(true, t));
    TEST_ASSERT_FALSE(g.step(true, t + 499));
    TEST_ASSERT_FALSE(g.step(false, t + 500));
    TEST_ASSERT_FALSE(g.step(true, t + 501));
    TEST_ASSERT_FALSE(g.step(true, t + 1000));
    TEST_ASSERT_TRUE(g.step(true, t + 1001));
}

void test_a_reading_that_flaps_every_200_ms_or_every_40_ms_gives_at_most_one_change_a_second() {
    for (uint32_t period : {40u, 200u}) {
        InletGate g;
        g.step(true, 0);
        int changes = 0;
        bool last = true;
        std::vector<uint32_t> at;
        for (uint32_t t = 0; t < 20000; t += 10) {
            bool raw = (t / period) % 2 == 0;
            bool p = g.step(raw, t);
            if (p != last) {
                at.push_back(t);
                changes++;
                last = p;
            }
        }
        // drops (to absent) are at least 1500 ms apart: a hold of 1 s plus 500 ms steady
        uint32_t lastDrop = 0;
        for (size_t i = 0; i < at.size(); i++) {
            if (i % 2 == 0 && i > 0) {
                TEST_ASSERT_TRUE_MESSAGE(at[i] - lastDrop >= 1000, "two drops less than a second apart");
            }
            if (i % 2 == 0) lastDrop = at[i];
        }
        TEST_ASSERT_TRUE(changes <= 2 * (20000 / 1000) + 2);
    }
}

// audio reads the gate too: "audio on" is refused during the 1 s hold while the LEDs and the host port are off
void test_audio_is_refused_during_the_gate_hold_and_allowed_after_it() {
    InletGate gate;
    AudioControl audio;
    char reply[300];
    gate.step(true, 0);
    gate.step(false, 100);  // dropped
    for (uint32_t t = 110; t < 1090; t += 10) {
        bool present = gate.step(true, t);  // the raw reading is back at once, the gate holds absent
        TEST_ASSERT_FALSE(audio.request(true, present, reply, sizeof reply));
    }
    TEST_ASSERT_TRUE(audio.request(true, gate.step(true, 1110), reply, sizeof reply));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_the_inlet_is_latched_at_start_up_from_a_dark_rail_of_4_4_volts_or_more);
    RUN_TEST(test_a_loaded_rail_never_reads_as_the_inlet_gone_and_a_collapsed_one_does);
    RUN_TEST(test_the_sense_vin_truth_table_with_a_logic_input);
    RUN_TEST(test_the_gate_holds_absent_for_a_second_and_wants_a_steady_reading_to_come_back);
    RUN_TEST(test_audio_is_refused_during_the_gate_hold_and_allowed_after_it);
    RUN_TEST(test_a_reading_that_flaps_every_200_ms_or_every_40_ms_gives_at_most_one_change_a_second);
    RUN_TEST(test_without_the_inlet_audio_is_refused_the_keyboard_port_is_off_and_the_strip_is_dark);
    return UNITY_END();
}
