// the buzzer driver. Awaits a board: no real buzzer has been driven.
#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include <algorithm>
#include <vector>

#include "buzzer.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

// the driver's clock: the only time the driver ever sees. No caller passes one
struct Clk : public Clock {
    uint32_t t = 0;
    uint32_t nowMs() const override { return t; }
};

// a model of the output as the board has it: a sound ends BY ITSELF after the duration it was given (the board uses
// a one-shot timer) or earlier when silence() is called. It runs from its OWN clock, a separate variable, so a test
// can make it disagree with the driver's. It records the real on intervals in its own time
struct Out : public BuzzerOutput {
    const uint32_t *clock;
    explicit Out(const uint32_t *c) : clock(c) {}
    struct Interval {
        uint32_t start, end;
    };
    std::vector<Interval> done;
    bool active = false;
    uint32_t start = 0, until = 0;
    int tones = 0, silences = 0;
    uint16_t lastHz = 0;
    uint8_t lastDuty = 0;
    uint16_t lastMs = 0;
    void finish(uint32_t at) {
        if (active) {
            done.push_back({start, std::min(until, at)});
            active = false;
        }
    }
    void tone(uint16_t hz, uint8_t duty, uint16_t ms) override {
        finish(*clock);
        tones++;
        lastHz = hz;
        lastDuty = duty;
        lastMs = ms;
        active = true;
        start = *clock;
        until = *clock + ms;
    }
    void silence() override {
        silences++;
        finish(*clock);
    }
    void flush() { finish(0xFFFFFFFFu); }
};

// the driver and the output on one monotonic source (the board's case): the output's clock follows the driver's
struct Rig {
    Clk clk;
    uint32_t outClock = 0;
    Out out;
    Buzzer b;
    explicit Rig(bool jtag = false) : out(&outClock), b(out, clk, jtag) {}
    void advance(uint32_t ms) {
        clk.t += ms;
        outClock = clk.t;
    }
};

void test_it_is_silent_by_default_and_a_request_makes_no_sound() {
    Rig r;
    r.b.begin();
    TEST_ASSERT_EQUAL(1, r.out.silences);
    TEST_ASSERT_FALSE(r.b.soundOn());
    for (int i = 0; i < 1000; i++) {
        TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
        r.b.tick();
        r.advance(10);
    }
    TEST_ASSERT_EQUAL(0, r.out.tones);
}

void test_with_sound_on_a_sound_is_clamped_in_length_pitch_and_duty() {
    Rig r;
    r.advance(1000);
    r.b.setSoundOn(true);
    TEST_ASSERT_TRUE(r.b.request(50000, 60000, 100));
    TEST_ASSERT_EQUAL(Buzzer::kMaxHz, r.out.lastHz);
    TEST_ASSERT_EQUAL(Buzzer::kMaxSoundMs, r.out.lastMs);
    TEST_ASSERT_TRUE(r.out.lastDuty <= Buzzer::kMaxDutyPct);
    r.advance(Buzzer::kMaxSoundMs - 1);
    r.b.tick();
    TEST_ASSERT_TRUE(r.b.sounding());
    r.advance(1);
    r.b.tick();
    TEST_ASSERT_FALSE(r.b.sounding());
    r.advance(4000);
    TEST_ASSERT_TRUE(r.b.request(1, 100, 50));
    TEST_ASSERT_EQUAL(Buzzer::kMinHz, r.out.lastHz);
    TEST_ASSERT_TRUE(r.out.lastDuty <= Buzzer::kMaxDutyPct / 2 + 1);
    r.advance(4000);
    TEST_ASSERT_FALSE(r.b.request(1000, 100, 0));
}

void test_the_least_gap_between_sounds_and_no_overlap() {
    Rig r;
    r.b.setSoundOn(true);
    TEST_ASSERT_TRUE(r.b.request(1000, 100, 100));
    r.advance(50);
    TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
    r.advance(50);
    TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
    r.advance(Buzzer::kMinGapMs - 1);
    TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
    r.advance(1);
    TEST_ASSERT_TRUE(r.b.request(1000, 100, 100));
}

void test_turning_sound_off_and_on_in_the_middle_of_a_sound_does_not_skip_the_gap() {
    Rig r;
    r.b.setSoundOn(true);
    TEST_ASSERT_TRUE(r.b.request(1000, 250, 100));
    r.advance(239);
    r.b.setSoundOn(false);
    TEST_ASSERT_FALSE(r.b.sounding());
    r.b.setSoundOn(true);
    TEST_ASSERT_FALSE_MESSAGE(r.b.request(1000, 250, 100), "a request was accepted with no gap after the sound was stopped");
    r.advance(Buzzer::kMinGapMs - 1);
    TEST_ASSERT_FALSE(r.b.request(1000, 250, 100));
    r.advance(1);
    TEST_ASSERT_TRUE(r.b.request(1000, 250, 100));
    // a loop: toggling every 240 ms while asking every millisecond
    Rig c;
    c.b.setSoundOn(true);
    for (int i = 0; i < 10000; i++) {
        c.b.tick();
        if (i % 240 == 239) {
            c.b.setSoundOn(false);
            c.b.setSoundOn(true);
        }
        c.b.request(1000, 250, 100);
        c.advance(1);
    }
    c.out.flush();
    uint32_t onMs = 0;
    for (auto &i : c.out.done) onMs += i.end - i.start;
    TEST_ASSERT_TRUE_MESSAGE(onMs <= 10000 * 250 / 400 + 250, "the duty limit was got round by toggling the setting");
}

// the three limits, read from the output's own record, whatever the order of changes, stops, requests and late passes
static void checkLimits(Out &out) {
    out.flush();
    TEST_ASSERT_TRUE(out.done.size() > 20);
    for (size_t i = 0; i < out.done.size(); i++) {
        auto &s = out.done[i];
        TEST_ASSERT_TRUE_MESSAGE(s.end - s.start <= Buzzer::kMaxSoundMs, "a sound was longer than the longest sound");
        if (i > 0) {
            TEST_ASSERT_TRUE_MESSAGE(s.start - out.done[i - 1].end >= Buzzer::kMinGapMs, "the gap between sounds was shorter than the least gap");
        }
        uint32_t on = 0;
        for (size_t k = i; k < out.done.size() && out.done[k].start < s.start + 1000; k++) {
            on += std::min(out.done[k].end, s.start + 1000) - out.done[k].start;
        }
        TEST_ASSERT_TRUE_MESSAGE(on <= 700, "more than 700 ms on in a second");
    }
}

void test_random_toggles_stops_requests_and_late_passes_keep_all_three_limits() {
    for (unsigned seed = 1; seed <= 40; seed++) {
        srand(seed);
        Rig r;
        r.b.begin();
        r.b.setSoundOn(true);
        for (int step = 0; step < 30000; step++) {
            r.advance(1 + (rand() % 40 == 0 ? rand() % 3000 : rand() % 4));  // now and then a pass blocks for seconds
            switch (rand() % 8) {
                case 0:
                    r.b.setSoundOn(rand() % 2);
                    break;
                case 1:
                    r.b.stop();
                    break;
                case 2:
                    r.b.tick();
                    break;
                default:
                    r.b.request((uint16_t)(rand() % 6000), (uint16_t)(rand() % 700), (uint8_t)(rand() % 120));
                    break;
            }
        }
        checkLimits(r.out);
    }
}

// proof: a caller's stale or backwards time broke the gap. No caller can pass a time now and when the
// output's clock and the driver's disagree by a constant the limits still hold in the output's own time
void test_a_driver_clock_and_an_output_clock_that_disagree_by_an_offset_keep_the_limits() {
    for (uint32_t offset : {0u, 200u, 700u, 100000u, 0xFFFFFF00u}) {
        srand(7);
        Clk clk;
        uint32_t outClock = offset;
        Out out(&outClock);
        Buzzer b(out, clk, false);
        b.setSoundOn(true);
        for (int step = 0; step < 20000; step++) {
            uint32_t d = 1 + rand() % 5;
            clk.t += d;
            outClock += d;  // the same rate, a different origin
            if (rand() % 6 == 0) b.stop();
            if (rand() % 9 == 0) b.setSoundOn(rand() % 2);
            b.request(1000, 250, 100);
            b.tick();
        }
        checkLimits(out);
    }
}

void test_a_tick_that_arrives_three_seconds_late_finds_the_sound_already_ended_at_250_ms() {
    Rig r;
    r.b.setSoundOn(true);
    TEST_ASSERT_TRUE(r.b.request(1000, 5000, 100));
    r.advance(3000);  // the loop was blocked
    r.out.flush();
    TEST_ASSERT_EQUAL(1, (int)r.out.done.size());
    TEST_ASSERT_EQUAL(250, (int)(r.out.done[0].end - r.out.done[0].start));
    r.b.tick();
    TEST_ASSERT_FALSE(r.b.sounding());
    TEST_ASSERT_TRUE(r.b.request(1000, 100, 100));
}

void test_turning_sound_off_silences_a_sound_in_progress_and_blocks_the_next() {
    Rig r;
    r.b.setSoundOn(true);
    TEST_ASSERT_TRUE(r.b.request(1000, 200, 100));
    r.advance(10);
    r.b.setSoundOn(false);
    TEST_ASSERT_FALSE(r.b.sounding());
    TEST_ASSERT_EQUAL(1, r.out.silences);
    r.advance(5000);
    TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
}

void test_with_jtag_claimed_the_pin_is_never_driven_at_all() {
    Rig r(true);
    r.b.begin();
    r.b.setSoundOn(true);
    for (int i = 0; i < 1000; i++) {
        TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
        r.b.tick();
        r.advance(5);
    }
    r.b.stop();
    r.b.setSoundOn(false);
    TEST_ASSERT_EQUAL(0, r.out.tones);
    TEST_ASSERT_EQUAL(0, r.out.silences);
}

void test_the_clock_wrapping_does_not_end_a_sound_early_or_hold_the_gap_for_ever() {
    Rig r;
    r.clk.t = 0xFFFFFFF0u;
    r.outClock = r.clk.t;
    r.b.setSoundOn(true);
    TEST_ASSERT_TRUE(r.b.request(1000, 100, 100));
    r.advance(50);
    r.b.tick();
    TEST_ASSERT_TRUE(r.b.sounding());
    r.advance(50);  // wrapped past zero
    r.b.tick();
    TEST_ASSERT_FALSE(r.b.sounding());
    r.advance(10);
    TEST_ASSERT_FALSE(r.b.request(1000, 100, 100));
    r.advance(Buzzer::kMinGapMs);
    TEST_ASSERT_TRUE(r.b.request(1000, 100, 100));
}

void test_the_sound_command_prints_on_only_when_the_write_succeeded() {
    Rig r;
    const char *m = applySoundCommand(r.b, true, false);
    TEST_ASSERT_FALSE(r.b.soundOn());
    TEST_ASSERT_NOT_NULL(strstr(m, "could not be saved"));
    TEST_ASSERT_NULL(strstr(m, "sound: on"));
    m = applySoundCommand(r.b, true, true);
    TEST_ASSERT_TRUE(r.b.soundOn());
    TEST_ASSERT_NOT_NULL(strstr(m, "sound: on"));
    TEST_ASSERT_TRUE(r.b.request(1000, 200, 100));
    m = applySoundCommand(r.b, false, false);
    TEST_ASSERT_FALSE(r.b.soundOn());
    TEST_ASSERT_FALSE(r.b.sounding());
    TEST_ASSERT_NOT_NULL(strstr(m, "could not be cleared"));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_it_is_silent_by_default_and_a_request_makes_no_sound);
    RUN_TEST(test_with_sound_on_a_sound_is_clamped_in_length_pitch_and_duty);
    RUN_TEST(test_the_least_gap_between_sounds_and_no_overlap);
    RUN_TEST(test_turning_sound_off_and_on_in_the_middle_of_a_sound_does_not_skip_the_gap);
    RUN_TEST(test_random_toggles_stops_requests_and_late_passes_keep_all_three_limits);
    RUN_TEST(test_a_driver_clock_and_an_output_clock_that_disagree_by_an_offset_keep_the_limits);
    RUN_TEST(test_a_tick_that_arrives_three_seconds_late_finds_the_sound_already_ended_at_250_ms);
    RUN_TEST(test_turning_sound_off_silences_a_sound_in_progress_and_blocks_the_next);
    RUN_TEST(test_with_jtag_claimed_the_pin_is_never_driven_at_all);
    RUN_TEST(test_the_clock_wrapping_does_not_end_a_sound_early_or_hold_the_gap_for_ever);
    RUN_TEST(test_the_sound_command_prints_on_only_when_the_write_succeeded);
    return UNITY_END();
}
