// an independent check of the output guard, worked out from the documents and not from the guard's code: the limits
// are plain numbers (per light at most 3 off-to-on changes and 3 large rises of 100 thousandths in any second, the
// strip at most 30 lights going out and 2 large rises of its total of 1000 in any second) and the ceiling is worked
// out here from the supply setting (rating x 0.91 - 1763 mA, never above 2700), the audio ceiling (1200 mA) and the
// inlet (absent means 0), not read from the guard. The meter shares nothing with the guard but the Rgb struct. The
// ceiling changes every pass, goes to 0 and the brightness is full. Awaits a board like everything about the strip.
#include <stdio.h>
#include <stdlib.h>
#include <unity.h>

#include <algorithm>
#include <deque>
#include <string>
#include <vector>

#include "../support/fakes.h"
#include "outputguard.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static int lum(const Rgb &p) {
    return (int)((2126u * p.r + 7152u * p.g + 722u * p.b) / 2550u);
}

struct RisePhase {
    bool high = false;
    int lo = 0, hi = 0;
    std::deque<uint32_t> rises;
    void feed(int v, int thr, uint32_t t) {
        if (high) {
            hi = std::max(hi, v);
            if (hi - v >= thr) {
                high = false;
                lo = v;
            }
        } else {
            lo = std::min(lo, v);
            if (v - lo >= thr) {
                high = true;
                hi = v;
                rises.push_back(t);
            }
        }
    }
    void reset() {
        high = false;
        lo = hi = 0;
        rises.clear();
    }
};

static int inWindow(std::deque<uint32_t> &d, uint32_t t) {
    while (!d.empty() && t - d.front() >= 1000) d.pop_front();
    return (int)d.size();
}

struct Meter : public LedSink {
    FakeClock &clock;
    uint32_t ceiling = 2700;  // set by the test from its own arithmetic
    std::vector<Rgb> last;
    std::vector<RisePhase> light;
    std::vector<std::deque<uint32_t>> on;
    RisePhase strip;
    std::deque<uint32_t> falls, allOns;
    std::string first;
    long violations = 0;
    explicit Meter(FakeClock &c) : clock(c) {}
    void bad(const char *what, int v) {
        violations++;
        if (first.empty()) {
            char b[160];
            snprintf(b, sizeof b, "%s = %d at t=%u (ceiling %u)", what, v, clock.now, ceiling);
            first = b;
        }
    }
    void show(const Rgb *p, size_t n) override {
        uint32_t t = clock.now;
        if (light.size() < n) {
            light.resize(n);
            on.resize(n);
            last.resize(n);
        }
        uint64_t sum = 0;
        if (ceiling == 0) {
            // the strip has no supply: it must be dark. The forced fall is counted and not limited (it is not a choice),
            // but a drop is NOT a fresh start: every light's earlier off-to-on changes, the rises and the lights that
            // come on afterwards are all still counted
            for (size_t i = 0; i < n; i++) sum += (uint32_t)p[i].r + p[i].g + p[i].b;
            if (sum != 0) bad("a lit light with no supply", (int)sum);
            for (size_t i = 0; i < n; i++) {
                light[i].feed(0, 100, t);
            }
            strip.feed(0, 1000, t);
            falls.clear();
            last.assign(p, p + n);
            return;
        }
        int total = 0;
        for (size_t i = 0; i < n; i++) {
            bool l = (p[i].r | p[i].g | p[i].b) != 0, w = (last[i].r | last[i].g | last[i].b) != 0;
            if (l && !w) {
                on[i].push_back(t);
                allOns.push_back(t);
            }
            if (!l && w) falls.push_back(t);
            int k = inWindow(on[i], t);
            if (k > 3) bad("off-to-on of one light in a second", k);
            light[i].feed(lum(p[i]), 100, t);
            k = inWindow(light[i].rises, t);
            if (k > 3) bad("large rises of one light in a second", k);
            sum += (uint32_t)p[i].r + p[i].g + p[i].b;
            total += lum(p[i]);
        }
        int f = inWindow(falls, t);
        if (f > 30) bad("lights going out in a second", f);
        strip.feed(total, 1000, t);
        int s = inWindow(strip.rises, t);
        if (s > 2) bad("large rises of the strip in a second", s);
        double ma = (double)sum * 20.0 / 255.0 + (double)n;
        if (ma > ceiling) bad("estimate over the ceiling (mA)", (int)(ma - ceiling));
        last.assign(p, p + n);
    }
};

// the ceiling from the documents, as plain numbers
static uint32_t supplyCeilingFor(int rating) {
    long v = (long)(rating * 91L / 100) - 1763;
    return v > 2700 ? 2700 : (uint32_t)v;
}

static void runSeed(unsigned seed, int mode) {
    srand(seed);
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setLayout(180, 150, 150);
    guard.setAuxInUse(60);
    const int ratings[] = {2500, 3000, 4000, 5000, 6000};
    uint32_t supply = 2700;
    bool audio = false, inlet = true;
    int inletBack = 0;
    std::vector<Rgb> fr(390);
    int groups = 1 + rand() % 40, period = 1 + rand() % 6;
    for (int step = 0; step < 1500; step++) {
        // the ceiling changes at nearly every pass
        if (rand() % 2 == 0) {
            supply = supplyCeilingFor(ratings[rand() % 5]);
            if (rand() % 4 == 0) supply = 2700;
        }
        if (rand() % 4 == 0) audio = !audio;
        if (inlet && rand() % 25 == 0) {
            inlet = false;
            inletBack = 1 + rand() % 5;
        } else if (!inlet && --inletBack <= 0) {
            inlet = true;
        }
        guard.setSupplyCeiling(inlet ? (uint16_t)supply : 0);
        guard.setAudioActive(audio);
        meter.ceiling = !inlet ? 0 : (audio && 1200 < supply ? 1200 : supply);
        if (mode == 0 || step % period == 0) {
            for (int i = 0; i < 390; i++) {
                int r = rand() % 100;
                if (mode == 1) {
                    fr[i] = ((i / (390 / groups)) + step / period) % 2 ? Rgb{255, 255, 255} : Rgb{};
                } else if (r < 40) {
                    fr[i] = Rgb{};
                } else if (r < 70) {
                    fr[i] = Rgb{(uint8_t)(rand() % 256), (uint8_t)(rand() % 256), (uint8_t)(rand() % 256)};
                } else if (r < 90) {
                    fr[i] = Rgb{255, 255, 255};
                } else {
                    fr[i] = Rgb{1, 0, 0};
                }
            }
        }
        guard.showOutputs(fr.data(), 180, fr.data() + 180, 150, fr.data() + 330, 60);
        clock.advance(1 + rand() % 40);
    }
    char msg[200];
    snprintf(msg, sizeof msg, "seed %u mode %d: %ld violations, first: %s", seed, mode, meter.violations, meter.first.c_str());
    TEST_ASSERT_EQUAL_MESSAGE(0, (int)meter.violations, msg);
}

void test_random_frames_at_full_brightness_with_the_ceiling_changing_every_pass_and_going_to_zero() {
    unsigned seeds = getenv("GUARD3_SEEDS") ? (unsigned)atoi(getenv("GUARD3_SEEDS")) : 60;
    for (unsigned seed = 1; seed <= seeds; seed++) {
        runSeed(seed, 0);
    }
}

void test_groups_taking_turns_at_full_brightness_with_the_ceiling_changing_every_pass() {
    unsigned seeds = getenv("GUARD3_SEEDS") ? (unsigned)atoi(getenv("GUARD3_SEEDS")) : 60;
    for (unsigned seed = 1; seed <= seeds; seed++) {
        runSeed(seed, 1);
    }
}

// a hostile case: a ceiling that drops while lights are held and blink within their own limits
void test_a_ceiling_that_drops_while_lights_are_held_breaks_no_limit() {
    long cases = 0;
    for (int n : {5, 31, 120, 300}) {
        for (int period : {1, 3, 5}) {
            for (int dropAt : {20, 22, 25, 30}) {
                for (int to : {512, 600, 1200}) {
                    for (uint32_t ms : {16u, 20u, 50u}) {
                        FakeClock clock;
                        Meter meter(clock);
                        OutputGuard guard(clock, meter);
                        guard.setLayout(180, 150, 150);
                        guard.setAuxInUse(60);
                        std::vector<Rgb> fr(390);
                        for (int step = 0; step < 400; step++) {
                            if (step == dropAt) {
                                guard.setSupplyCeiling((uint16_t)to);
                                meter.ceiling = (uint32_t)to;
                            }
                            if (step == dropAt + 150) {
                                guard.setSupplyCeiling(2700);
                                meter.ceiling = 2700;
                            }
                            std::fill(fr.begin(), fr.end(), Rgb{});
                            for (int i = 0; i < 50; i++) fr[389 - i] = Rgb{255, 255, 255};
                            if ((step / period) % 2 == 0) {
                                for (int i = 0; i < n && i < 340; i++) fr[i] = Rgb{255, 255, 255};
                            }
                            guard.showOutputs(fr.data(), 180, fr.data() + 180, 150, fr.data() + 330, 60);
                            clock.advance(ms);
                        }
                        cases++;
                        char msg[200];
                        snprintf(msg, sizeof msg, "n=%d period=%d drop %d to %d at %u ms: %s", n, period, dropAt, to, ms, meter.first.c_str());
                        TEST_ASSERT_EQUAL_MESSAGE(0, (int)meter.violations, msg);
                    }
                }
            }
        }
    }
    TEST_ASSERT_TRUE(cases > 400);
}

// a forced fall at ceiling 0 (the inlet dropped, the strip has no supply) is not limited: nothing can be shown
void test_with_no_supply_everything_goes_dark_at_once_and_that_is_not_limited() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setLayout(180, 150, 150);
    guard.setAuxInUse(60);
    std::vector<Rgb> on(390, Rgb{50, 50, 50});
    for (int i = 0; i < 5; i++) {
        guard.showOutputs(on.data(), 180, on.data() + 180, 150, on.data() + 330, 60);
        clock.advance(20);
    }
    guard.setSupplyCeiling(0);
    meter.ceiling = 0;
    guard.showOutputs(on.data(), 180, on.data() + 180, 150, on.data() + 330, 60);
    TEST_ASSERT_TRUE(guard.allDark());  // all 390 went out in one pass: forced, counted and not limited
    TEST_ASSERT_EQUAL(0, (int)meter.violations);
}

// a flapping case: the supply ceiling at 0 for one pass every 200 ms. Every 40 ms, with light 0 asked steady
// white (and also blinking inside its own limits). A light must not come on more than 3 times in any second whatever
// darkened it. The inlet gate keeps this from happening in the firmware, so here the guard is driven without it
static void flapRun(uint32_t everyMs, bool blink, int lights) {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setLayout(180, 150, 150);
    guard.setAuxInUse(60);
    std::vector<Rgb> fr(390);
    for (int step = 0; step < 1500; step++) {  // 30 s at 20 ms
        bool zero = (clock.now % everyMs) < 20;
        guard.setSupplyCeiling(zero ? 0 : 2700);
        meter.ceiling = zero ? 0 : 2700;
        std::fill(fr.begin(), fr.end(), Rgb{});
        for (int i = 0; i < lights; i++) {
            fr[i] = (!blink || (clock.now / 90) % 2 == 0) ? Rgb{127, 127, 127} : Rgb{};
        }
        guard.showOutputs(fr.data(), 180, fr.data() + 180, 150, fr.data() + 330, 60);
        clock.advance(20);
    }
    char msg[200];
    snprintf(msg, sizeof msg, "ceiling 0 every %u ms, blink %d, %d lights: %s", everyMs, blink, lights, meter.first.c_str());
    TEST_ASSERT_EQUAL_MESSAGE(0, (int)meter.violations, msg);
}

void test_a_ceiling_that_flaps_to_zero_cannot_make_a_light_come_on_more_than_three_times_a_second() {
    for (uint32_t every : {40u, 100u, 200u, 400u}) {
        for (bool blink : {false, true}) {
            for (int lights : {1, 10, 60, 390}) {
                flapRun(every, blink, lights);
            }
        }
    }
}

// the power-on hold: every output dark for the first half second, whatever is asked, then the asked frame
class FrameSink : public LedSink {
   public:
    std::vector<Rgb> last;
    uint32_t shows = 0;
    void show(const Rgb *px, size_t n) override {
        last.assign(px, px + n);
        shows++;
    }
    size_t lit() const {
        size_t n = 0;
        for (const Rgb &p : last) n += (p.r | p.g | p.b) != 0;
        return n;
    }
};

void test_every_output_stays_dark_for_half_a_second_after_power_on() {
    FakeClock clock;
    FrameSink sink;
    OutputGuard guard(clock, sink);
    guard.setLayout(12, 6, 4);
    guard.setPowerOnHold(OutputGuard::kPowerOnHoldMs);
    TEST_ASSERT_EQUAL_UINT32(500, OutputGuard::kPowerOnHoldMs);
    Rgb keys[12], frets[6], aux[4];
    for (Rgb &p : keys) p = {40, 40, 40};
    for (Rgb &p : frets) p = {40, 0, 0};
    for (Rgb &p : aux) p = {0, 0, 40};
    for (uint32_t t = 0; t < 500; t += 20) {
        clock.now = t;
        guard.showOutputs(keys, 12, frets, 6, aux, 4);
        TEST_ASSERT_EQUAL_size_t(22, sink.last.size());
        TEST_ASSERT_EQUAL_size_t(0, sink.lit());
        TEST_ASSERT_TRUE(guard.holding());
    }
    TEST_ASSERT_EQUAL_UINT32(25, sink.shows);  // every frame still reaches the strip, as dark
}

void test_the_first_frame_after_the_hold_lights_normally_and_the_hold_never_returns() {
    FakeClock clock;
    FrameSink sink;
    OutputGuard guard(clock, sink);
    guard.setLayout(12, 0, 0);
    guard.setPowerOnHold(OutputGuard::kPowerOnHoldMs);
    Rgb keys[12];
    for (Rgb &p : keys) p = {40, 40, 40};
    clock.now = 480;
    guard.showOutputs(keys, 12, nullptr, 0, nullptr, 0);
    TEST_ASSERT_EQUAL_size_t(0, sink.lit());
    clock.now = 500;
    guard.showOutputs(keys, 12, nullptr, 0, nullptr, 0);
    TEST_ASSERT_FALSE(guard.holding());
    TEST_ASSERT_EQUAL_size_t(12, sink.lit());
    // the clock wrapping round to a small value again does not bring the hold back
    clock.now = 10;
    guard.showOutputs(keys, 12, nullptr, 0, nullptr, 0);
    TEST_ASSERT_EQUAL_size_t(12, sink.lit());
}

void test_without_a_hold_the_first_frame_lights_at_once() {
    FakeClock clock;
    FrameSink sink;
    OutputGuard guard(clock, sink);
    guard.setLayout(12, 0, 0);
    Rgb keys[12];
    for (Rgb &p : keys) p = {40, 40, 40};
    guard.showOutputs(keys, 12, nullptr, 0, nullptr, 0);
    TEST_ASSERT_FALSE(guard.holding());
    TEST_ASSERT_EQUAL_size_t(12, sink.lit());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_random_frames_at_full_brightness_with_the_ceiling_changing_every_pass_and_going_to_zero);
    RUN_TEST(test_groups_taking_turns_at_full_brightness_with_the_ceiling_changing_every_pass);
    RUN_TEST(test_a_ceiling_that_drops_while_lights_are_held_breaks_no_limit);
    RUN_TEST(test_a_ceiling_that_flaps_to_zero_cannot_make_a_light_come_on_more_than_three_times_a_second);
    RUN_TEST(test_with_no_supply_everything_goes_dark_at_once_and_that_is_not_limited);
    RUN_TEST(test_every_output_stays_dark_for_half_a_second_after_power_on);
    RUN_TEST(test_the_first_frame_after_the_hold_lights_normally_and_the_hold_never_returns);
    RUN_TEST(test_without_a_hold_the_first_frame_lights_at_once);
    return UNITY_END();
}
