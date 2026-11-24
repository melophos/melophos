// the guard's gaps: the strip as a whole, many small swings at once, the ceiling
// creating swings, a lowered ceiling that never reached a steady frame and thresholds that nothing pinned.
#include <string.h>
#include <unity.h>

#include <stdlib.h>

#include <vector>

#include "../support/fakes.h"
#include "hub.h"
#include "outputguard.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static const KeyboardProfile kPiano{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false};

static int lumY(const Rgb &p) {
    return (int)((2126u * p.r + 7152u * p.g + 722u * p.b) / 2550u);
}

// counts at the strip, with its own copies of the rules
class Meter : public LedSink {
   public:
    explicit Meter(FakeClock &c) : clock_(c) {}
    std::vector<Rgb> last;
    std::vector<uint32_t> falls;             // every lit to dark change of any LED, with its time
    std::vector<uint32_t> litRises[kGuardLeds];     // off to on, per LED
    std::vector<uint32_t> swingRises[kGuardLeds];   // large rises of one LED
    std::vector<uint32_t> stripRises;        // large rises of the strip's total luminance
    int lowY[kGuardLeds] = {}, highY[kGuardLeds] = {};
    bool high[kGuardLeds] = {};
    int sLow = 0, sHigh = 0;
    bool sHighPhase = false;
    uint32_t shows = 0;
    double lastMa = 0;
    void show(const Rgb *px, size_t n) override {
        uint32_t now = clock_.nowMs();
        int total = 0;
        for (size_t i = 0; i < n; i++) {
            bool lit = (px[i].r | px[i].g | px[i].b) != 0;
            bool was = i < last.size() && (last[i].r | last[i].g | last[i].b) != 0;
            if (lit && !was) {
                litRises[i].push_back(now);
            }
            if (!lit && was) {
                falls.push_back(now);
            }
            int y = lumY(px[i]);
            total += y;
            if (high[i]) {
                highY[i] = y > highY[i] ? y : highY[i];
                if (highY[i] - y >= 100) {
                    high[i] = false;
                    lowY[i] = y;
                }
            } else {
                lowY[i] = y < lowY[i] ? y : lowY[i];
                if (y - lowY[i] >= 100) {
                    high[i] = true;
                    highY[i] = y;
                    swingRises[i].push_back(now);
                }
            }
        }
        if (sHighPhase) {
            sHigh = total > sHigh ? total : sHigh;
            if (sHigh - total >= 1000) {
                sHighPhase = false;
                sLow = total;
            }
        } else {
            sLow = total < sLow ? total : sLow;
            if (total - sLow >= 1000) {
                sHighPhase = true;
                sHigh = total;
                stripRises.push_back(now);
            }
        }
        lastMa = (double)estimateMilliamps(px, n);
        last.assign(px, px + n);
        shows++;
    }
    static int worstIn(const std::vector<uint32_t> &v, uint32_t window = 1000) {
        int w = 0;
        for (size_t i = 0; i < v.size(); i++) {
            int n = 0;
            for (size_t k = i; k < v.size() && v[k] - v[i] < window; k++) {
                n++;
            }
            w = n > w ? n : w;
        }
        return w;
    }
    int worstLitRises() const {
        int w = 0;
        for (auto &v : litRises) w = std::max(w, worstIn(v));
        return w;
    }
    int worstSwingRises() const {
        int w = 0;
        for (auto &v : swingRises) w = std::max(w, worstIn(v));
        return w;
    }

   private:
    FakeClock &clock_;
};

struct Rig {
    FakeClock clock;
    Meter meter{clock};
    OutputGuard guard{clock, meter};
    NoteBus bus;
    PracticeHub hub{clock, guard, bus, 88};
    Rig() {
        hub.setProfile(kPiano);
        RenderSettings rs;
        rs.master = 255;
        hub.setRender(rs);
    }
};

// a. the whole bar: 8 groups of 10 keys in turn, each key at 3 a second, flashes the bar 24 times a second
void test_groups_in_turn_cannot_flash_the_bar() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    Rgb frame[88];
    for (int t = 0; t < 6000; t++) {
        clock.advance(1);
        memset(frame, 0, sizeof frame);
        int slot = (t / 42) % 8;  // a group is on for 42 ms in a 336 ms turn: 3 rises a second each
        for (int k = 0; k < 10; k++) {
            frame[slot * 10 + k] = Rgb{128, 75, 0};
        }
        guard.show(frame, 88);
    }
    TEST_ASSERT_TRUE(meter.worstLitRises() <= 3);                                  // every LED is at 3 at most
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.falls) <= 30, "the bar flashed: more than 30 lights went out in a second");
}

// a. the small-area allowance lets a few keys through at once: a pressed key still lights at once
void test_a_pressed_key_still_lights_at_once_and_a_small_group_changes_freely() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    Rgb frame[88] = {};
    for (int t = 0; t < 3000; t++) {
        clock.advance(1);
        memset(frame, 0, sizeof frame);
        int key = (t / 400) % 8;  // one key at a time, every 400 ms
        frame[key] = Rgb{128, 75, 0};
        guard.show(frame, 88);
        TEST_ASSERT_TRUE((meter.last[(size_t)key].r | meter.last[(size_t)key].g) != 0);  // lit in the very pass it was asked
    }
}

// b. all 180 lights swing 98 thousandths (under the per-light threshold) together at 20 Hz
void test_many_small_swings_at_once_are_limited_as_a_whole() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    Rgb hi[180], lo[180];
    for (int i = 0; i < 180; i++) {
        hi[i] = Rgb{35, 35, 35};  // luminance 137 of 1000
        lo[i] = Rgb{10, 10, 10};  // luminance 39: a swing of 98, under the per-light threshold
    }
    for (int t = 0; t < 6000; t++) {
        clock.advance(1);
        guard.show((t / 25) % 2 ? hi : lo, 180);
    }
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.stripRises) <= 2, "the strip's total luminance swung more than 2 times a second");
}

// the thresholds: a swing of 120 (between 10 and 15 per cent) at 20 Hz on one light and off to dim on/off
void test_a_swing_just_over_10_per_cent_is_limited() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    Rgb a{60, 60, 60}, b{30, 30, 30};  // luminance 235 and 117: a swing of 118, between 10 and 15 per cent
    TEST_ASSERT_TRUE(lumY(a) - lumY(b) >= 100 && lumY(a) - lumY(b) < 150);
    for (int t = 0; t < 4000; t++) {
        clock.advance(1);
        guard.show((t / 25) % 2 ? &a : &b, 1);
    }
    TEST_ASSERT_TRUE(meter.worstSwingRises() <= 3);
}

void test_off_to_dim_on_is_limited_by_the_edge_rule_alone() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    Rgb dim{12, 6, 0}, off{0, 0, 0};  // luminance about 6: far under any swing threshold
    for (int t = 0; t < 4000; t++) {
        clock.advance(1);
        guard.show((t / 25) % 2 ? &dim : &off, 1);
    }
    TEST_ASSERT_TRUE(meter.worstLitRises() <= 3);
}

// a held light must be released once the content stops changing, with no new frame from the content
void test_a_held_light_goes_out_once_the_content_stops_changing() {
    Rig r;
    for (int t = 0; t < 3000; t++) {  // a source that flickers one key hard
        r.clock.advance(1);
        if (t % 25 == 0) {
            r.bus.push(NoteEvent{r.clock.nowMs(), 60, (uint8_t)((t / 25) % 2 ? 90 : 0), 0, NoteSource::UsbMidi});
        }
        r.hub.step();
    }
    r.bus.push(NoteEvent{r.clock.nowMs(), 60, 0, 0, NoteSource::UsbMidi});
    for (int t = 0; t < 1500; t++) {  // then nothing at all
        r.clock.advance(1);
        r.hub.step();
    }
    TEST_ASSERT_EQUAL(0, r.meter.last[60 - 21].r | r.meter.last[60 - 21].g | r.meter.last[60 - 21].b);
}

// c. the ceiling must not make a steady light swing as others come and go
void test_a_steady_light_does_not_swing_under_a_low_ceiling_as_others_come_and_go() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setSupplyCeiling(600);
    Rgb frame[88];
    for (int t = 0; t < 5000; t++) {
        clock.advance(1);
        memset(frame, 0, sizeof frame);
        frame[40] = Rgb{128, 75, 0};  // the steady guide
        int others = (t / 100) % 2 ? 60 : 0;  // sixty more lights every other 100 ms: over the 600 mA ceiling
        for (int k = 0; k < others; k++) {
            frame[k] = Rgb{128, 75, 0};
        }
        guard.show(frame, 88);
    }
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.swingRises[40], 5000) <= 6, "a steady light swung with the ceiling");
    TEST_ASSERT_TRUE(meter.worstSwingRises() <= 3);
}

// d. a lowered ceiling reaches a frame that is not changing
void test_a_lowered_ceiling_reaches_a_steady_frame_without_a_flash() {
    Rig r;
    GuideSet guides;
    for (uint8_t n = 40; n < 60; n++) {
        guides.set(n, true);
    }
    r.hub.engine().setExternalGuides(&guides);
    for (int t = 0; t < 500; t++) {
        r.clock.advance(1);
        r.hub.step();
    }
    double before = r.meter.lastMa;
    TEST_ASSERT_TRUE(before > 600);
    r.guard.setSupplyCeiling(600);  // the frame itself does not change
    for (int t = 0; t < 20; t++) {  // within 20 ms of the change
        r.clock.advance(1);
        r.hub.step();
    }
    TEST_ASSERT_TRUE_MESSAGE(r.meter.lastMa <= 600, "the strip kept drawing more than the new ceiling");
    for (size_t i = 0; i < r.meter.last.size(); i++) {
        bool lit = (r.meter.last[i].r | r.meter.last[i].g | r.meter.last[i].b) != 0;
        TEST_ASSERT_TRUE(lit == (i >= 19 && i < 39));  // dimmer, never dark
    }
    TEST_ASSERT_TRUE(r.meter.worstLitRises() <= 1);
    // raising it again brings the brightness back within a second and a half, in one step
    r.guard.setSupplyCeiling(2700);
    for (int t = 0; t < 1500; t++) {
        r.clock.advance(1);
        r.hub.step();
    }
    TEST_ASSERT_TRUE(r.meter.lastMa > 700);
}

// each of these fails when its rule is weakened

// the strip's own luminance threshold: 25 lights each swinging by 59 (under the per-light 100) change the strip
// by 1475, which is over 1000 and under three times 1000
void test_the_strip_threshold_is_what_limits_a_swing_of_25_lights_by_59_each() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    std::vector<Rgb> f(180);
    for (int step = 0; step < 100; step++) {  // 5 s at 20 Hz
        uint8_t g = step % 2 ? 25 : 10;
        for (int i = 0; i < 25; i++) {
            f[i] = Rgb{g, g, g};
        }
        guard.show(f.data(), 180);
        clock.advance(50);
    }
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.stripRises) <= 2, "the strip swung more than 2 times a second");
}

// the last safety ceiling: held lights are added after the scale was worked out, so the frame must be checked again
void test_the_shown_current_never_exceeds_the_ceiling_even_when_held_lights_are_added() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setSupplyCeiling(600);
    std::vector<Rgb> a(180), b(180);
    for (int i = 0; i < 60; i++) {
        a[i] = Rgb{29, 29, 29};
        b[i + 60] = Rgb{29, 29, 29};
    }
    guard.show(a.data(), 180);
    TEST_ASSERT_TRUE(meter.lastMa <= 600.0);
    clock.advance(20);
    for (int k = 0; k < 20; k++) {  // the 60 lights go out at once while 60 others come on: 30 of them are held
        guard.show(b.data(), 180);
        TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= 600.0, "the shown current went over the ceiling");
        clock.advance(20);
    }
}

// the floor: a lit light keeps at least level 1 of its strongest channel under any ceiling of 200 mA or more (the
// idle draw of 180 LEDs is 180 mA and a full strip of lights at level 1 adds 14 mA). The lowest ceiling the
// firmware ever sets is 600 mA. Under the idle draw dark is the only safe frame and the guard shows it
void test_a_lit_light_is_never_scaled_to_dark_at_any_ceiling_of_200_mA_or_more() {
    const uint16_t ceilings[] = {200, 250, 300, 600, 2700};
    for (uint16_t ceiling : ceilings) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        guard.setSupplyCeiling(ceiling);
        std::vector<Rgb> f(180);
        for (int i = 0; i < 100; i++) {
            f[i] = i % 3 == 0 ? Rgb{120, 10, 0} : (i % 3 == 1 ? Rgb{0, 90, 0} : Rgb{0, 0, 80});
        }
        for (int i = 100; i < 180; i++) {  // dim guides next to bright ones: the scale would round them to nothing
            f[i] = i % 3 == 0 ? Rgb{1, 0, 0} : (i % 3 == 1 ? Rgb{0, 1, 0} : Rgb{0, 0, 1});
        }
        guard.show(f.data(), 180);
        for (int i = 0; i < 180; i++) {
            TEST_ASSERT_TRUE_MESSAGE((meter.last[i].r | meter.last[i].g | meter.last[i].b) != 0, "a lit light was scaled to dark");
        }
        TEST_ASSERT_TRUE(meter.lastMa <= (double)ceiling + 0.5);
    }
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setSupplyCeiling(150);  // under the idle draw of 180 LEDs
    std::vector<Rgb> f(180, Rgb{50, 0, 0});
    guard.show(f.data(), 180);
    TEST_ASSERT_TRUE(guard.allDark());
}

// ---------- three outputs, one ceiling and one set of flash limits (awaits a board) ----------

// the hub board: 180 key lights, 150 fret lights and the third output at its hard maximum of 150, of which 60 are
// in use. The guard always reserves the idle draw of all 150
static const size_t kKeys = 180, kFrets = 150, kAux = 150, kAuxInUse = 60;

static void hubLayout(OutputGuard &g) {
    g.setLayout(kKeys, kFrets, kAux);
    g.setAuxInUse(kAuxInUse);
}

// the ceiling is a TOTAL over every strip, never a figure per strip: a frame that fits on each output alone
// must still be scaled when the three are lit together
void test_the_ceiling_is_a_total_across_all_three_outputs() {
    const uint16_t ceilings[] = {2700, 1200, 900, 600};
    for (uint16_t ceiling : ceilings) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        hubLayout(guard);
        guard.setSupplyCeiling(ceiling);
        // 80 bright lights on each output. Each output on its own is under 2700 mA, the three together are not
        std::vector<Rgb> keys(kKeys), frets(kFrets), aux(kAux);
        for (int i = 0; i < 80; i++) {
            keys[i] = frets[i] = Rgb{120, 120, 120};
        }
        for (int i = 0; i < 150; i++) {
            aux[i] = Rgb{120, 120, 120};  // all 150 asked for, only the 60 in use may light
        }
        Rgb alone[kGuardLeds] = {};
        for (int i = 0; i < 80; i++) {
            alone[i] = Rgb{120, 120, 120};
        }
        TEST_ASSERT_TRUE(estimateMilliamps(alone, kKeys) < 2700);  // one output alone would pass a per strip ceiling
        for (int pass = 0; pass < 5; pass++) {
            guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
            TEST_ASSERT_EQUAL((int)(kKeys + kFrets + kAux), (int)meter.last.size());
            TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= (double)ceiling, "the three outputs together went over the ceiling");
            clock.advance(20);
        }
        // everything lit on every output
        std::vector<Rgb> all(kGuardLeds, Rgb{127, 127, 127});
        guard.showOutputs(all.data(), kKeys, all.data(), kFrets, all.data(), kAux);
        TEST_ASSERT_TRUE(meter.lastMa <= (double)ceiling);
    }
}

// the flash limits count across the outputs together: groups of ten that take turns on different outputs are
// still limited to 30 falls and 2 large rises of the whole
void test_the_flash_limits_count_across_all_three_outputs_together() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    hubLayout(guard);
    std::vector<Rgb> keys(kKeys), frets(kFrets), aux(kAux);
    for (int step = 0; step < 200; step++) {  // 10 s at 20 Hz
        std::fill(keys.begin(), keys.end(), Rgb{});
        std::fill(frets.begin(), frets.end(), Rgb{});
        std::fill(aux.begin(), aux.end(), Rgb{});
        int group = step % 9;  // nine groups of ten lights, three on each output, one lit at a time
        Rgb on{100, 100, 100};
        std::vector<Rgb> &out = group < 3 ? keys : group < 6 ? frets : aux;
        for (int i = 0; i < 10; i++) {
            out[(group % 3) * 10 + i] = on;
        }
        guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
        clock.advance(50);
    }
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.falls) <= 30, "more than 30 lights went out in a second across the outputs");
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.stripRises) <= 2, "the whole bar flickered more than 2 times a second");
    TEST_ASSERT_TRUE(meter.worstLitRises() <= 3);
}

// a pressed key still lights at once with the other outputs lit and flickering
void test_a_key_lights_at_once_while_the_other_outputs_are_busy() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    hubLayout(guard);
    std::vector<Rgb> keys(kKeys), frets(kFrets), aux(kAux);
    for (int step = 0; step < 40; step++) {
        std::fill(frets.begin(), frets.end(), Rgb{});
        for (int i = 0; i < 12; i++) {
            frets[(step * 7 + i * 5) % kFrets] = Rgb{60, 0, 60};
        }
        keys[40] = step == 10 ? Rgb{100, 60, 0} : keys[40];
        guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
        if (step == 10) {
            TEST_ASSERT_TRUE((meter.last[40].r | meter.last[40].g | meter.last[40].b) != 0);
        }
        clock.advance(20);
    }
}

// the third output: data goes only to the length in use and the idle draw of the MAXIMUM length is always in the
// total, so a 150 light strip plugged in can never put the total over any ceiling
void test_a_longest_strip_on_the_third_output_cannot_put_the_total_over_any_ceiling() {
    const uint16_t ceilings[] = {2700, 1200, 900, 600, 512};
    for (uint16_t ceiling : ceilings) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        hubLayout(guard);
        guard.setSupplyCeiling(ceiling);
        std::vector<Rgb> all(kGuardLeds, Rgb{127, 127, 127});
        for (int pass = 0; pass < 3; pass++) {
            guard.showOutputs(all.data(), kKeys, all.data(), kFrets, all.data(), kAux);
            clock.advance(20);
        }
        TEST_ASSERT_EQUAL((int)(kKeys + kFrets + kAux), (int)meter.last.size());  // the guard judged all 480
        // the estimate on the whole frame counts the unlit lights of a 150 light strip: idle draw of all 150
        Rgb dark[kGuardLeds] = {};
        TEST_ASSERT_TRUE(estimateMilliamps(dark, kKeys + kFrets + kAux) == 480);
        TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= (double)ceiling, "the total including the idle draw of a 150 light strip went over the ceiling");
        for (size_t i = kKeys + kFrets + kAuxInUse; i < kKeys + kFrets + kAux; i++) {
            TEST_ASSERT_TRUE_MESSAGE((meter.last[i].r | meter.last[i].g | meter.last[i].b) == 0, "data went past the length in use");
        }
    }
    // a length in use over the maximum is clamped to it
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setLayout(kKeys, kFrets, kAux);
    guard.setAuxInUse(400);
    TEST_ASSERT_EQUAL((int)kAux, (int)guard.auxInUse());
}

// probe: k white lights and every other light at level 1. The estimate after the floor must never be over
// the ceiling, at any of the figures the firmware sets, down to the 2.5 A supply setting's 512 mA
void test_the_estimate_after_the_floor_is_never_over_the_ceiling() {
    TEST_ASSERT_EQUAL(512, (int)ledCeilingForSupply(2500));  // the lowest ceiling the firmware sets
    const uint16_t ceilings[] = {2700, 1200, 900, 600, 512};
    for (uint16_t ceiling : ceilings) {
        for (size_t k = 1; k <= kKeys + kFrets + kAuxInUse; k += 7) {
            FakeClock clock;
            Meter meter(clock);
            OutputGuard guard(clock, meter);
            hubLayout(guard);
            guard.setSupplyCeiling(ceiling);
            std::vector<Rgb> keys(kKeys), frets(kFrets), aux(kAux);
            for (size_t i = 0; i < kKeys + kFrets + kAuxInUse; i++) {
                Rgb v = i < k ? Rgb{127, 127, 127} : Rgb{1, 0, 0};
                if (i < kKeys) keys[i] = v;
                else if (i < kKeys + kFrets) frets[i - kKeys] = v;
                else aux[i - kKeys - kFrets] = v;
            }
            guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
            char msg[80];
            snprintf(msg, sizeof msg, "over the %u mA ceiling with %u white lights", ceiling, (unsigned)k);
            TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= (double)ceiling, msg);
        }
    }
}

// the edge of the floor, exactly: with all 390 lights that can be lit at level 1 the idle draw (480) and the floor's
// 390 x 20 / 255 need 511 mA. From 511 up every light stays lit. Below it lights go dark from the highest index and
// never in any other order. At or under the idle draw the frame is dark
void test_the_floor_edge_is_511_mA_and_lights_go_dark_highest_index_first() {
    const size_t lit = kKeys + kFrets + kAuxInUse;  // 390
    for (uint16_t ceiling : {(uint16_t)511, (uint16_t)512, (uint16_t)513, (uint16_t)600}) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        hubLayout(guard);
        guard.setSupplyCeiling(ceiling);
        std::vector<Rgb> keys(kKeys, Rgb{1, 0, 0}), frets(kFrets, Rgb{1, 0, 0}), aux(kAux, Rgb{1, 0, 0});
        guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
        size_t on = 0;
        for (size_t i = 0; i < meter.last.size(); i++) on += (meter.last[i].r | meter.last[i].g | meter.last[i].b) != 0;
        TEST_ASSERT_EQUAL_MESSAGE((int)lit, (int)on, "a light went dark at a ceiling of 511 mA or more");
        TEST_ASSERT_TRUE(meter.lastMa <= (double)ceiling);
    }
    for (uint16_t ceiling : {(uint16_t)510, (uint16_t)500, (uint16_t)490, (uint16_t)481}) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        hubLayout(guard);
        guard.setSupplyCeiling(ceiling);
        std::vector<Rgb> keys(kKeys, Rgb{1, 0, 0}), frets(kFrets, Rgb{1, 0, 0}), aux(kAux, Rgb{1, 0, 0});
        guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
        TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= (double)ceiling, "over the ceiling at the floor's edge");
        size_t on = 0, lastLit = 0;
        for (size_t i = 0; i < meter.last.size(); i++) {
            if ((meter.last[i].r | meter.last[i].g | meter.last[i].b) != 0) {
                on++;
                lastLit = i;
            }
        }
        TEST_ASSERT_TRUE_MESSAGE(on < lit, "no light went dark under 511 mA");
        TEST_ASSERT_EQUAL_MESSAGE((int)on - 1, (int)lastLit, "lights did not go dark from the highest index first");  // a lit prefix
    }
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    hubLayout(guard);
    guard.setSupplyCeiling(480);  // the idle draw itself
    std::vector<Rgb> keys(kKeys, Rgb{1, 0, 0});
    guard.showOutputs(keys.data(), kKeys, nullptr, 0, nullptr, 0);
    TEST_ASSERT_TRUE(guard.allDark());
}

// ---------- the invariant, as a property ----------

// what leaves the guard, whatever goes in: for random sequences of input frames, with steady frames, content that
// flickers every pass and a ceiling that changes mid-run (supply setting, audio, the rail), the frames that LEAVE
// the guard never exceed the ceiling in total, never exceed 3 off-to-on or 3 large rises per light in a second and
// never exceed the strip's limits (30 lights out and 2 large rises of the total over any second). The meter counts
// with its own code at the strip
static void runProperty(unsigned seed, bool threeOutputs) {
    srand(seed);
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    if (threeOutputs) {
        hubLayout(guard);
    }
    const size_t lights = threeOutputs ? kKeys + kFrets + kAuxInUse : 180;
    const uint16_t supplies[] = {2500, 3000, 4000, 5000, 6000};
    std::vector<Rgb> frame(kGuardLeds), keys(kKeys), frets(kFrets), aux(kAux);
    int mode = 0;
    double worstOver = -1e9;
    for (int step = 0; step < 600; step++) {
        if (step % 40 == 0) {
            mode = rand() % 4;
            if (rand() % 3 == 0) guard.setSupplyCeiling(ledCeilingForSupply(supplies[rand() % 5]));
            if (rand() % 3 == 0) guard.setAudioActive(rand() % 2);
            if (rand() % 3 == 0) guard.setRailPinMv((uint16_t)(1900 + rand() % 700));
        }
        if (mode == 0 && step % 40 == 0) {  // a steady frame, as bright and as full as the content may make it
            int white = rand() % 80, dim = rand() % 3;
            for (size_t i = 0; i < kGuardLeds; i++) {
                frame[i] = i < lights ? (i < (size_t)white ? Rgb{127, 127, 127} : (dim ? Rgb{(uint8_t)dim, 0, 0} : Rgb{})) : Rgb{};
            }
        } else if (mode == 1) {  // random lights change every pass
            for (size_t i = 0; i < kGuardLeds; i++) {
                frame[i] = i < lights && rand() % 6 == 0 ? Rgb{(uint8_t)(rand() % 128), (uint8_t)(rand() % 128), (uint8_t)(rand() % 128)} : Rgb{};
            }
        } else if (mode == 2) {  // a chase of groups taking turns
            for (size_t i = 0; i < kGuardLeds; i++) {
                frame[i] = i < lights && (i / 10) % 8 == (size_t)(step % 8) ? Rgb{100, 100, 100} : Rgb{};
            }
        } else if (mode == 3) {  // everything flips between bright and dim
            for (size_t i = 0; i < kGuardLeds; i++) {
                frame[i] = i < lights ? (step % 2 ? Rgb{120, 120, 120} : Rgb{3, 3, 3}) : Rgb{};
            }
        }
        if (threeOutputs) {
            for (size_t i = 0; i < kKeys; i++) keys[i] = frame[i];
            for (size_t i = 0; i < kFrets; i++) frets[i] = frame[kKeys + i];
            for (size_t i = 0; i < kAux; i++) aux[i] = frame[kKeys + kFrets + i];
            guard.showOutputs(keys.data(), kKeys, frets.data(), kFrets, aux.data(), kAux);
        } else {
            guard.show(frame.data(), 180);
        }
        double over = meter.lastMa - (double)guard.effectiveCeiling();
        if (over > worstOver) worstOver = over;
        TEST_ASSERT_TRUE_MESSAGE(over <= 0, "a frame that left the guard was over the ceiling in total");
        clock.advance(20);
    }
    char msg[100];
    snprintf(msg, sizeof msg, "seed %u: a light rose more than 3 times from off in a second", seed);
    TEST_ASSERT_TRUE_MESSAGE(meter.worstLitRises() <= 3, msg);
    snprintf(msg, sizeof msg, "seed %u: a light made more than 3 large rises in a second", seed);
    TEST_ASSERT_TRUE_MESSAGE(meter.worstSwingRises() <= 3, msg);
    snprintf(msg, sizeof msg, "seed %u: more than 30 lights went out in a second", seed);
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.falls) <= 30, msg);
    snprintf(msg, sizeof msg, "seed %u: the strip's total made more than 2 large rises in a second", seed);
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.stripRises) <= 2, msg);
}

void test_whatever_leaves_the_guard_keeps_the_ceiling_and_every_flash_limit_over_random_sequences() {
    for (unsigned seed = 1; seed <= 40; seed++) {
        runProperty(seed, true);
        runProperty(seed + 1000, false);
    }
}

// two steady frames exactly: key 0 white with the rest at (1,0,0), steady. It put 66 lights out every 1.08 s
void test_two_steady_frames_do_not_flicker_at_any_ceiling() {
    for (uint16_t ceiling : {(uint16_t)512, (uint16_t)600, (uint16_t)700, (uint16_t)900, (uint16_t)1200, (uint16_t)2700}) {
        for (int lights : {180, 390}) {
            FakeClock clock;
            Meter meter(clock);
            OutputGuard guard(clock, meter);
            hubLayout(guard);
            guard.setSupplyCeiling(ceiling);
            std::vector<Rgb> all(kGuardLeds, Rgb{});
            for (int i = 0; i < lights; i++) all[i] = Rgb{1, 0, 0};
            all[0] = Rgb{255, 255, 255};
            for (int step = 0; step < 400; step++) {
                guard.showOutputs(all.data(), kKeys, all.data() + kKeys, kFrets, all.data() + kKeys + kFrets, kAux);
                clock.advance(20);
            }
            char msg[80];
            snprintf(msg, sizeof msg, "a steady frame flickered at %u mA with %d lights", ceiling, lights);
            TEST_ASSERT_EQUAL_MESSAGE(0, (int)Meter::worstIn(meter.falls) > 1 ? 1 : 0, msg);
            TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= (double)ceiling, msg);
        }
    }
}

// proof: the fall budget was given out lowest index first, so a high-index light (the fret and aux
// outputs are always the high ones) could stay lit for ever while lower lights blinked inside every limit
void test_a_light_asked_dark_goes_dark_within_the_stated_time_however_the_others_blink() {
    for (int flick : {20, 40, 80}) {
        for (int period : {250, 500}) {
            for (int askAt : {100, 112, 113, 125, 137}) {
                FakeClock clock;
                Meter meter(clock);
                OutputGuard guard(clock, meter);
                hubLayout(guard);
                std::vector<Rgb> fr(kGuardLeds);
                int darkAfter = -1;
                for (int step = 0; step < 1500; step++) {  // 30 s at 50 Hz
                    std::fill(fr.begin(), fr.end(), Rgb{});
                    if (step < askAt) fr[389] = Rgb{100, 60, 0};  // the last aux light, then asked dark for ever
                    if ((clock.now / period) % 2 == 0) {
                        for (int i = 0; i < flick; i++) fr[i] = Rgb{100, 100, 100};
                    }
                    guard.showOutputs(fr.data(), kKeys, fr.data() + kKeys, kFrets, fr.data() + kKeys + kFrets, kAux);
                    bool lit = (meter.last[389].r | meter.last[389].g | meter.last[389].b) != 0;
                    if (step >= askAt && !lit && darkAfter < 0) darkAfter = (int)clock.now - askAt * 20;
                    clock.advance(20);
                }
                char msg[100];
                snprintf(msg, sizeof msg, "light 389 still lit: %d blinking every %d ms, asked at step %d", flick, period, askAt);
                TEST_ASSERT_TRUE_MESSAGE(darkAfter >= 0, msg);
                TEST_ASSERT_TRUE_MESSAGE(darkAfter <= (int)OutputGuard::kFallWaitBoundMs(1), msg);
            }
        }
    }
}

// with every light asked dark at once the bound is the number of lights over 30 a second, plus a second of holds
void test_every_light_asked_dark_at_once_is_dark_within_the_stated_bound() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    hubLayout(guard);
    std::vector<Rgb> on(kGuardLeds, Rgb{20, 20, 20}), off(kGuardLeds);
    for (int i = 0; i < 3; i++) {
        guard.showOutputs(on.data(), kKeys, on.data(), kFrets, on.data(), kAux);
        clock.advance(20);
    }
    uint32_t from = clock.now;
    uint32_t darkAt = 0;
    for (int step = 0; step < 1500 && darkAt == 0; step++) {
        guard.showOutputs(off.data(), kKeys, off.data(), kFrets, off.data(), kAux);
        if (guard.allDark()) darkAt = clock.now - from;
        clock.advance(20);
    }
    TEST_ASSERT_TRUE_MESSAGE(darkAt != 0, "the lights never all went dark");
    TEST_ASSERT_TRUE_MESSAGE(darkAt <= OutputGuard::kFallWaitBoundMs(kKeys + kFrets + kAuxInUse), "slower than the stated bound");
}

// second regression: when the ceiling falls while lights are held, the guard dropped the whole bar to the
// floor for about a second. A steady frame must not dim below what the new ceiling allows
void test_a_steady_frame_does_not_dim_when_the_ceiling_falls_while_lights_are_held() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);  // the key strip alone: 180 lights
    std::vector<Rgb> churn(180), steady(180);
    for (int i = 0; i < 100; i++) steady[i] = Rgb{100, 100, 100};
    // two seconds of churn at the full ceiling: lights are held lit and bright
    for (int step = 0; step < 100; step++) {
        for (int i = 0; i < 180; i++) churn[i] = (i + step) % 3 == 0 ? Rgb{127, 127, 127} : Rgb{};
        guard.show(churn.data(), 180);
        clock.advance(20);
    }
    guard.setSupplyCeiling(600);
    Rgb copy[180];
    memcpy(copy, steady.data(), sizeof copy);
    uint16_t ideal = applyCeiling(copy, 180, 600);
    TEST_ASSERT_TRUE(ideal > 8);
    for (int step = 0; step < 100; step++) {  // from the very first pass after the drop
        guard.show(steady.data(), 180);
        TEST_ASSERT_TRUE_MESSAGE(meter.lastMa <= 600.0, "over the lowered ceiling");
        TEST_ASSERT_TRUE_MESSAGE(guard.scale() >= ideal / 2, "the whole bar dropped to the floor when the ceiling fell");
        clock.advance(20);
    }
}

// ---------- going dark at once (darkNow) ----------

// 48 lights lit for a lesson, then a stop: with darkNow they are dark in the very next frame. Without it the fall queue
// of 30 a second keeps 18 of them lit for another second
void test_a_stop_goes_dark_at_once_and_without_it_the_fall_queue_would_take_a_second() {
    for (int immediate = 0; immediate < 2; immediate++) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        std::vector<Rgb> on(88), off(88);
        for (int i = 0; i < 48; i++) on[i] = Rgb{100, 60, 0};
        for (int i = 0; i < 5; i++) {
            guard.show(on.data(), 88);
            clock.advance(20);
        }
        if (immediate) guard.darkNow();
        guard.show(off.data(), 88);
        if (immediate) {
            TEST_ASSERT_TRUE_MESSAGE(guard.allDark(), "darkNow did not go dark in the next frame");
        } else {
            TEST_ASSERT_FALSE(guard.allDark());
        }
    }
}

// darkNow bypasses the fall queue and nothing else: lights asked on and off with it at every pass still never come on
// more than 3 times a second each, the strip never rises more than 3 times a second and the ceiling holds
void test_dark_now_used_at_every_pass_still_counts_every_relight() {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    guard.setSupplyCeiling(2700);
    std::vector<Rgb> on(88), off(88);
    for (int i = 0; i < 88; i++) on[i] = Rgb{120, 100, 60};
    for (int step = 0; step < 600; step++) {  // 12 s at 20 ms: on, then a stop, every other pass
        if (step % 2 == 0) {
            guard.show(on.data(), 88);
        } else {
            guard.darkNow();
            guard.show(off.data(), 88);
        }
        TEST_ASSERT_TRUE(meter.lastMa <= 2700.0);
        clock.advance(20);
    }
    TEST_ASSERT_TRUE_MESSAGE(meter.worstLitRises() <= 3, "a light came on more than 3 times in a second after darkNow");
    TEST_ASSERT_TRUE_MESSAGE(meter.worstSwingRises() <= 3, "a light made more than 3 large rises in a second");
    TEST_ASSERT_TRUE_MESSAGE(Meter::worstIn(meter.stripRises) <= 2, "the strip rose more than 2 times in a second");
}

// the hub: a stop and a mode change go dark in the next frame
void test_the_hub_goes_dark_at_once_on_a_stop_and_a_mode_change() {
    Rig r;
    static LessonStep steps[] = {{0, 4, {60, 62, 64, 65}, 0}};
    PracticeSettings ps;
    char msg[80];
    TEST_ASSERT_TRUE(r.hub.engine().start(Mode::Melody, Lesson{steps, 1}, ps, 0, msg, sizeof msg));
    for (int i = 0; i < 20; i++) {
        r.hub.step();
        r.clock.advance(20);
    }
    TEST_ASSERT_FALSE(r.guard.allDark());
    r.hub.engine().stop();
    r.hub.step();
    TEST_ASSERT_TRUE_MESSAGE(r.guard.allDark(), "a stop did not go dark in the next frame");
}

// the banner: ten keys only and gone in the frame after its two seconds
void test_the_insecure_banner_lights_ten_keys_and_goes_out_at_once() {
    Rig r;
    r.hub.setInsecure(true);
    int most = 0;
    bool wentOutAtOnce = true;
    bool wasOn = false;
    for (uint32_t t = 0; t < 70000; t += 20) {
        r.clock.now = t;
        r.hub.step();
        int lit = 0;
        for (auto &p : r.meter.last) lit += (p.r | p.g | p.b) != 0;
        most = lit > most ? lit : most;
        bool on = PracticeHub::bannerOn(t);
        if (wasOn && !on && lit != 0) wentOutAtOnce = false;
        wasOn = on;
    }
    TEST_ASSERT_EQUAL(10, most);
    TEST_ASSERT_TRUE_MESSAGE(wentOutAtOnce, "the banner did not go out in the frame after its two seconds");
    TEST_ASSERT_TRUE(r.meter.worstLitRises() <= 3);
    TEST_ASSERT_TRUE(Meter::worstIn(r.meter.stripRises) <= 2);
}

// ---------- re-lights: the strip-level count that darkNow needs ----------

struct SwapResult {
    int worstOut = 0;      // lights going out in any second
    int worstOn = 0;       // off-to-on changes of any one light in a second
    int worstRelights = 0; // lights coming on within a second of going dark, in any second
    int stripRises = 0;
};

static SwapResult runSwap(int lights, int periodPasses, bool halves, bool useDarkNow, bool stripLimit = true) {
    FakeClock clock;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    hubLayout(guard);
    guard.setStripLimit(stripLimit);
    std::vector<Rgb> fr(kGuardLeds);
    std::vector<uint32_t> relightAt;
    std::vector<uint32_t> wentDark(kGuardLeds, 0);
    std::vector<bool> everLit(kGuardLeds, false);
    std::vector<Rgb> prev(kGuardLeds);
    for (int step = 0; step < 1000; step++) {
        int phase = (step / periodPasses) % 2;
        for (int i = 0; i < (int)kGuardLeds; i++) {
            bool lit;
            if (halves) {
                lit = i < lights && (i < lights / 2 ? phase == 0 : phase == 1);
            } else {
                lit = i < lights && phase == 0;
            }
            fr[i] = lit ? Rgb{30, 30, 30} : Rgb{};
        }
        if (useDarkNow) guard.darkNow();
        guard.showOutputs(fr.data(), kKeys, fr.data() + kKeys, kFrets, fr.data() + kKeys + kFrets, kAux);
        for (size_t i = 0; i < meter.last.size(); i++) {
            bool lit = (meter.last[i].r | meter.last[i].g | meter.last[i].b) != 0;
            bool was = (prev[i].r | prev[i].g | prev[i].b) != 0;
            if (!lit && was) wentDark[i] = clock.now;
            if (lit && !was && everLit[i] && clock.now - wentDark[i] < 1000) relightAt.push_back(clock.now);
            if (lit) everLit[i] = true;
        }
        prev = meter.last;
        clock.advance(20);
    }
    SwapResult r;
    r.worstOut = Meter::worstIn(meter.falls);
    r.worstOn = meter.worstLitRises();
    r.worstRelights = Meter::worstIn(relightAt);
    r.stripRises = Meter::worstIn(meter.stripRises);
    return r;
}

// proof: two halves of the bar swap 6 times a second, each light 3 on a second, the total level, so the
// strip's rise limit sees one rise while 1,170 lights go out every second
void test_two_halves_swapping_through_dark_now_cannot_go_past_30_relights_a_second() {
    for (int period : {1, 2, 4, 8}) {
        SwapResult r = runSwap(390, period, true, true);
        char msg[120];
        snprintf(msg, sizeof msg, "halves every %d passes with darkNow: %d re-lights in a second", period, r.worstRelights);
        TEST_ASSERT_TRUE_MESSAGE(r.worstRelights <= (int)OutputGuard::kMaxRelightsPerSecond, msg);
        TEST_ASSERT_TRUE(r.worstOn <= 3);
    }
}

void test_the_whole_bar_flashing_through_dark_now_is_held_to_30_relights_a_second() {
    for (int lights : {48, 180, 390}) {
        for (int period : {1, 4, 8, 17}) {
            SwapResult r = runSwap(lights, period, false, true);
            char msg[120];
            snprintf(msg, sizeof msg, "%d lights on and off every %d passes with darkNow: %d re-lights in a second", lights, period, r.worstRelights);
            TEST_ASSERT_TRUE_MESSAGE(r.worstRelights <= (int)OutputGuard::kMaxRelightsPerSecond, msg);
            TEST_ASSERT_TRUE(r.worstOn <= 3);
            TEST_ASSERT_TRUE(r.stripRises <= 2);
        }
    }
}

// removing the count fails these: with it off (the strip limit switched off) the halves go far past 30
void test_without_the_relight_count_the_halves_swap_freely() {
    SwapResult r = runSwap(390, 2, true, true, false);
    TEST_ASSERT_TRUE_MESSAGE(r.worstRelights > (int)OutputGuard::kMaxRelightsPerSecond, "the test cannot see the count: it does not need it");
}

// a lesson start after a stop: guides dark for more than a second are free, under a second only 30 come at once and the
// rest follow in under a second
void test_a_lesson_start_after_a_stop_is_free_after_a_second_and_waits_under_a_second_before() {
    for (uint32_t gapMs : {400u, 1100u}) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        std::vector<Rgb> on(88), off(88);
        for (int i = 0; i < 48; i++) on[i] = Rgb{100, 60, 0};
        for (int i = 0; i < 5; i++) {
            guard.show(on.data(), 88);
            clock.advance(20);
        }
        guard.darkNow();
        guard.show(off.data(), 88);
        TEST_ASSERT_TRUE(guard.allDark());
        clock.advance(gapMs);
        guard.show(on.data(), 88);  // the lesson starts again
        int lit = 0;
        for (auto &p : meter.last) lit += (p.r | p.g | p.b) != 0;
        if (gapMs > 1000) {
            TEST_ASSERT_EQUAL_MESSAGE(48, lit, "guides dark for over a second did not light at once");
        } else {
            TEST_ASSERT_TRUE_MESSAGE(lit <= (int)OutputGuard::kMaxRelightsPerSecond, "more than 30 re-lights at once inside a second");
            TEST_ASSERT_TRUE(lit >= 1);
            for (int k = 0; k < 60 && lit < 48; k++) {  // and the rest follow in under a second
                clock.advance(20);
                guard.show(on.data(), 88);
                lit = 0;
                for (auto &p : meter.last) lit += (p.r | p.g | p.b) != 0;
            }
            TEST_ASSERT_EQUAL(48, lit);
        }
    }
}

// mode changes come as fast as a caller likes: the hub gives darkNow at most once a second
void test_the_hub_asks_for_dark_at_once_at_most_once_a_second_however_fast_the_mode_changes() {
    struct Counting : public LedSink {
        int darkNows = 0;
        void show(const Rgb *, size_t) override {}
        void darkNow() override { darkNows++; }
    } sink;
    FakeClock clock;
    NoteBus bus;
    PracticeHub hub(clock, sink, bus, 88);
    hub.setProfile(kPiano);
    static LessonStep steps[] = {{0, 1, {60}, 0}};
    PracticeSettings ps;
    char msg[80];
    for (int step = 0; step < 500; step++) {  // 10 s at 20 ms, a mode change every pass
        hub.engine().start(step % 2 ? Mode::Melody : Mode::Listen, Lesson{steps, 1}, ps, clock.now, msg, sizeof msg);
        hub.step();
        clock.advance(20);
    }
    TEST_ASSERT_TRUE_MESSAGE(sink.darkNows <= 11, "the hub asked for dark at once more than once a second");
    TEST_ASSERT_TRUE(sink.darkNows >= 5);
}

// nine interleaved groups, one lit at a time for 120 ms, darkNow at every swap. Every limit
// passes per light and for the total, yet the whole bar shimmers at 8 Hz. The guard honours darkNow once a second only
void test_nine_groups_rolling_with_dark_now_at_every_swap_cannot_shimmer_the_bar() {
    for (int limited = 0; limited < 2; limited++) {
        FakeClock clock;
        Meter meter(clock);
        OutputGuard guard(clock, meter);
        hubLayout(guard);
        std::vector<Rgb> fr(kGuardLeds), prev(kGuardLeds);
        int lastGroup = -1, bigSwaps = 0, swaps = 0, blanks = 0;
        bool wasBright = false;
        for (int step = 0; step < 750; step++) {  // 15 s
            int grp = (int)((clock.now / 120) % 9);
            for (size_t i = 0; i < kGuardLeds; i++) fr[i] = (int)(i % 9) == grp ? Rgb{255, 255, 255} : Rgb{};  // all 390 asked, groups of 43
            bool swap = grp != lastGroup;
            if (swap) guard.darkNow();
            lastGroup = grp;
            guard.showOutputs(fr.data(), kKeys, fr.data() + kKeys, kFrets, fr.data() + kKeys + kFrets, kAux);
            // a shimmer is a pass in which a large group is put out at once: count the passes where more than 30 lights
            // went out together, which only darkNow can do
            int changed = 0;  // lights that went OUT in this pass
            for (size_t i = 0; i < meter.last.size(); i++) {
                changed += !(meter.last[i].r | meter.last[i].g | meter.last[i].b) && (prev[i].r | prev[i].g | prev[i].b);
            }
            if (swap) {
                swaps++;
                if (changed > OutputGuard::kMaxFallsPerSecond) bigSwaps++;
            }
            // the bar going blank after it was lit, again and again, is the shimmer
            int lit = 0;
            for (size_t i = 0; i < meter.last.size(); i++) lit += (meter.last[i].r | meter.last[i].g | meter.last[i].b) != 0;
            if (lit >= 30) wasBright = true;
            if (lit <= 2 && wasBright) {
                blanks++;
                wasBright = false;
            }
            for (size_t i = 0; i < meter.last.size(); i++) prev[i] = meter.last[i];
            clock.advance(20);
        }
        char msg[120];
        snprintf(msg, sizeof msg, "%d of %d swaps put out more than 30 lights at once in 15 s", bigSwaps, swaps);
        TEST_ASSERT_TRUE_MESSAGE(bigSwaps <= 16, msg);  // at most once a second: 15 s gives 15 or 16
        snprintf(msg, sizeof msg, "the bar went blank after being lit %d times in 15 s", blanks);
        TEST_ASSERT_TRUE_MESSAGE(blanks <= 2, msg);
        (void)limited;
    }
}

// across the timer wrap
void test_the_dark_now_limit_holds_across_the_timer_wrap() {
    FakeClock clock;
    clock.now = 0xFFFFFF00u;
    Meter meter(clock);
    OutputGuard guard(clock, meter);
    std::vector<Rgb> on(88, Rgb{20, 20, 20}), off(88);
    int immediate = 0;
    for (int step = 0; step < 100; step++) {  // 2 s over the wrap, darkNow at every pass
        guard.show(step % 2 ? off.data() : on.data(), 88);
        guard.darkNow();
        immediate += guard.allDark() ? 1 : 0;
        clock.advance(20);
    }
    TEST_ASSERT_TRUE(immediate >= 1);
    TEST_ASSERT_TRUE_MESSAGE(immediate <= 50, "darkNow honoured far more than once a second over the wrap");
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_groups_in_turn_cannot_flash_the_bar);
    RUN_TEST(test_a_pressed_key_still_lights_at_once_and_a_small_group_changes_freely);
    RUN_TEST(test_many_small_swings_at_once_are_limited_as_a_whole);
    RUN_TEST(test_a_swing_just_over_10_per_cent_is_limited);
    RUN_TEST(test_off_to_dim_on_is_limited_by_the_edge_rule_alone);
    RUN_TEST(test_a_held_light_goes_out_once_the_content_stops_changing);
    RUN_TEST(test_a_steady_light_does_not_swing_under_a_low_ceiling_as_others_come_and_go);
    RUN_TEST(test_a_lowered_ceiling_reaches_a_steady_frame_without_a_flash);
    RUN_TEST(test_the_strip_threshold_is_what_limits_a_swing_of_25_lights_by_59_each);
    RUN_TEST(test_the_shown_current_never_exceeds_the_ceiling_even_when_held_lights_are_added);
    RUN_TEST(test_a_lit_light_is_never_scaled_to_dark_at_any_ceiling_of_200_mA_or_more);
    RUN_TEST(test_the_ceiling_is_a_total_across_all_three_outputs);
    RUN_TEST(test_the_flash_limits_count_across_all_three_outputs_together);
    RUN_TEST(test_a_key_lights_at_once_while_the_other_outputs_are_busy);
    RUN_TEST(test_whatever_leaves_the_guard_keeps_the_ceiling_and_every_flash_limit_over_random_sequences);
    RUN_TEST(test_two_steady_frames_do_not_flicker_at_any_ceiling);
    RUN_TEST(test_a_light_asked_dark_goes_dark_within_the_stated_time_however_the_others_blink);
    RUN_TEST(test_every_light_asked_dark_at_once_is_dark_within_the_stated_bound);
    RUN_TEST(test_a_steady_frame_does_not_dim_when_the_ceiling_falls_while_lights_are_held);
    RUN_TEST(test_a_stop_goes_dark_at_once_and_without_it_the_fall_queue_would_take_a_second);
    RUN_TEST(test_dark_now_used_at_every_pass_still_counts_every_relight);
    RUN_TEST(test_the_hub_goes_dark_at_once_on_a_stop_and_a_mode_change);
    RUN_TEST(test_the_insecure_banner_lights_ten_keys_and_goes_out_at_once);
    RUN_TEST(test_two_halves_swapping_through_dark_now_cannot_go_past_30_relights_a_second);
    RUN_TEST(test_the_whole_bar_flashing_through_dark_now_is_held_to_30_relights_a_second);
    RUN_TEST(test_without_the_relight_count_the_halves_swap_freely);
    RUN_TEST(test_a_lesson_start_after_a_stop_is_free_after_a_second_and_waits_under_a_second_before);
    RUN_TEST(test_the_hub_asks_for_dark_at_once_at_most_once_a_second_however_fast_the_mode_changes);
    RUN_TEST(test_nine_groups_rolling_with_dark_now_at_every_swap_cannot_shimmer_the_bar);
    RUN_TEST(test_the_dark_now_limit_holds_across_the_timer_wrap);
    RUN_TEST(test_a_longest_strip_on_the_third_output_cannot_put_the_total_over_any_ceiling);
    RUN_TEST(test_the_estimate_after_the_floor_is_never_over_the_ceiling);
    RUN_TEST(test_the_floor_edge_is_511_mA_and_lights_go_dark_highest_index_first);
    return UNITY_END();
}
