#include <string.h>
#include <unity.h>

#include <vector>

#include "../support/fakes.h"
#include "hub.h"
#include "identity.h"
#include "midi.h"
#include "outputguard.h"
#include "provision.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static const KeyboardProfile kPiano{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false};

// records every frame that reaches the strip with the time it arrived
class EdgeSink : public LedSink {
   public:
    explicit EdgeSink(FakeClock &c) : clock_(c) {}
    std::vector<Rgb> last;
    std::vector<uint32_t> rises[180];
    uint32_t shows = 0;
    void show(const Rgb *px, size_t n) override {
        for (size_t i = 0; i < n; i++) {
            bool lit = (px[i].r | px[i].g | px[i].b) != 0;
            bool was = i < last.size() && (last[i].r | last[i].g | last[i].b) != 0;
            if (lit && !was) {
                rises[i].push_back(clock_.nowMs());
            }
        }
        count(px, n);
        last.assign(px, px + n);
        shows++;
    }
    // the most LARGE brightness rises of any one LED inside any one second. A rise is large when the light
    // goes up by 10 per cent of full white or more from the lowest it has been since its last large fall.
    // Counted here from the pixels that reach the strip, with its own copy of the rule, not the guard's
    std::vector<uint32_t> swingRises[180];
    int lowY[180] = {};
    int highY[180] = {};
    bool high[180] = {};
    void count(const Rgb *px, size_t n) {
        for (size_t i = 0; i < n; i++) {
            int y = (int)((2126u * px[i].r + 7152u * px[i].g + 722u * px[i].b) / 2550u);
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
                    swingRises[i].push_back(clock_.nowMs());
                }
            }
        }
    }
    int worstSwings() const {
        int w = 0;
        for (size_t l = 0; l < 180; l++) {
            for (size_t i = 0; i < swingRises[l].size(); i++) {
                int n = 0;
                for (size_t k = i; k < swingRises[l].size() && swingRises[l][k] - swingRises[l][i] < 1000; k++) {
                    n++;
                }
                w = n > w ? n : w;
            }
        }
        return w;
    }
    // the most rising edges of any one LED inside any one second
    int worst() const {
        int w = 0;
        for (auto &v : rises) {
            for (size_t i = 0; i < v.size(); i++) {
                int n = 0;
                for (size_t k = i; k < v.size() && v[k] - v[i] < 1000; k++) {
                    n++;
                }
                w = n > w ? n : w;
            }
        }
        return w;
    }

   private:
    FakeClock &clock_;
};

static const char *kNoLimit = "set by the test that proves the limit is needed";

struct Rig {
    FakeClock clock;
    EdgeSink edges{clock};
    OutputGuard guard{clock, edges};
    NoteBus bus;
    PracticeHub hub{clock, guard, bus, 88};
    uint64_t violations = 0;
    Rig() {
        hub.setProfile(kPiano);
        RenderSettings rs;
        rs.master = 255;
        hub.setRender(rs);
    }
    // one loop pass and the check that a light the content wants lit is lit at the strip
    void step() {
        hub.step();
        const Rgb *want = guard.requested();
        for (size_t i = 0; i < guard.count() && i < edges.last.size(); i++) {
            bool wl = (want[i].r | want[i].g | want[i].b) != 0;
            bool lit = (edges.last[i].r | edges.last[i].g | edges.last[i].b) != 0;
            violations += wl && !lit;
        }
    }
    void run(int ms, void (*each)(Rig &, int)) {
        for (int t = 0; t < ms; t++) {
            each(*this, t);
            clock.advance(1);
            step();
        }
    }
};

static NoteEvent ev(uint32_t t, uint8_t note, uint8_t vel) {
    return NoteEvent{t, note, vel, 0, NoteSource::UsbMidi};
}

void test_the_jack_at_20_hz_never_flashes_more_than_three_times_a_second() {
    static MidiParser parser(NoteSource::MidiJack);
    Rig r;
    BusSink sink(r.bus);
    r.run(6000, [](Rig &r, int t) {
        BusSink s(r.bus);
        if (t % 40 == 0) {  // note on, 40 ms of it held, then off, on 16 keys
            for (uint8_t k = 40; k < 56; k++) {
                uint8_t on[3] = {0x90, k, 90};
                for (uint8_t b : on) parser.feed(b, r.clock.nowMs(), s);
            }
        } else if (t % 40 == 20) {
            for (uint8_t k = 40; k < 56; k++) {
                uint8_t off[3] = {0x80, k, 0};
                for (uint8_t b : off) parser.feed(b, r.clock.nowMs(), s);
            }
        }
    });
    TEST_ASSERT_TRUE_MESSAGE(r.edges.worst() <= 3, "a light flashed more than 3 times in a second");
    TEST_ASSERT_TRUE(r.edges.worstSwings() <= 3);
    TEST_ASSERT_EQUAL(0, (int)r.violations);
    TEST_ASSERT_TRUE(r.edges.worst() >= 1);  // and the keys did light
}

void test_usb_at_20_hz() {
    static UsbMidiParser parser;
    Rig r;
    r.run(6000, [](Rig &r, int t) {
        BusSink s(r.bus);
        if (t % 50 == 0 || t % 50 == 25) {
            bool on = t % 50 == 0;
            for (uint8_t k = 60; k < 72; k++) {
                uint8_t pkt[4] = {(uint8_t)(on ? 0x09 : 0x08), (uint8_t)(on ? 0x90 : 0x80), k, (uint8_t)(on ? 90 : 0)};
                parser.feedTransfer(pkt, 4, r.clock.nowMs(), s);
            }
        }
    });
    TEST_ASSERT_TRUE(r.edges.worst() <= 3);
    TEST_ASSERT_TRUE_MESSAGE(r.edges.worstSwings() <= 3, "a light made more than 3 large brightness rises in a second");
    TEST_ASSERT_EQUAL(0, (int)r.violations);
}

void test_a_bluetooth_host_toggling_48_guides_at_20_hz() {
    static FakeBlePort port;
    static GuideSet guides;
    static BleMidiLink link(port, guides);
    link.onConnect();
    link.onEncrypted(true);
    Rig r;
    r.hub.engine().setExternalGuides(&guides);
    r.run(6000, [](Rig &r, int t) {
        if (t % 25 == 0) {
            bool on = (t / 25) % 2 == 0;
            for (uint8_t k = 30; k < 78; k++) {
                uint8_t pkt[5] = {0x80, 0x80, (uint8_t)(on ? 0x90 : 0x80), k, (uint8_t)(on ? 100 : 0)};
                link.onReceive(pkt, 5, r.clock.nowMs());
            }
        }
    });
    TEST_ASSERT_TRUE(r.edges.worst() <= 3);
    TEST_ASSERT_TRUE_MESSAGE(r.edges.worstSwings() <= 3, "a light made more than 3 large brightness rises in a second");
    TEST_ASSERT_EQUAL(0, (int)r.violations);
}

void test_listen_mode_at_240_bpm_on_sixteenths() {
    static LessonStep steps[40];
    for (int i = 0; i < 40; i++) {
        steps[i] = LessonStep{(uint16_t)i, 1, {60}, 0};  // the same key on every sixteenth
    }
    Rig r;
    PracticeSettings ps;
    ps.bpm = 240;
    char msg[80];
    TEST_ASSERT_TRUE(r.hub.engine().start(Mode::Listen, Lesson{steps, 40}, ps, 0, msg, sizeof msg));
    r.run(2600, [](Rig &, int) {});
    TEST_ASSERT_TRUE(r.edges.worst() <= 3);
    TEST_ASSERT_TRUE_MESSAGE(r.edges.worstSwings() <= 3, "a light made more than 3 large brightness rises in a second");
    TEST_ASSERT_EQUAL(0, (int)r.violations);
}

void test_wrong_notes_mashed_and_the_insecure_glow() {
    Rig r;
    r.hub.setInsecure(true);
    static LessonStep one[] = {{0, 1, {60}, 0}};
    PracticeSettings ps;
    char msg[80];
    r.hub.engine().start(Mode::Melody, Lesson{one, 1}, ps, 0, msg, sizeof msg);
    r.run(8000, [](Rig &r, int t) {
        if (t % 50 == 0) {
            r.bus.push(ev(r.clock.nowMs(), (uint8_t)(70 + (t / 50) % 3), 90));
            r.bus.push(ev(r.clock.nowMs(), (uint8_t)(70 + (t / 50) % 3), 0));
        }
    });
    TEST_ASSERT_TRUE(r.edges.worst() <= 3);
    TEST_ASSERT_TRUE_MESSAGE(r.edges.worstSwings() <= 3, "a light made more than 3 large brightness rises in a second");
    TEST_ASSERT_EQUAL(0, (int)r.violations);
}

// the guard itself, with a hostile source that flips every light every millisecond
void test_the_guard_holds_a_light_lit_when_it_has_no_edge_to_spare() {
    FakeClock clock;
    EdgeSink edges(clock);
    OutputGuard guard(clock, edges);
    Rgb on[10], off[10];
    for (int i = 0; i < 10; i++) {
        on[i] = Rgb{200, 100, 50};
        off[i] = Rgb{0, 0, 0};
    }
    for (int t = 0; t < 4000; t++) {
        clock.advance(1);
        guard.show(t % 2 ? on : off, 10);
        if (t % 2) {
            for (int i = 0; i < 10; i++) {
                TEST_ASSERT_TRUE(edges.last[(size_t)i].r > 0);  // asked lit, so lit
            }
        }
    }
    TEST_ASSERT_TRUE(edges.worst() <= 3);
    // when content finally stays off the light does go out, after the held second
    for (int t = 0; t < 1100; t++) {
        clock.advance(1);
        guard.show(off, 10);
    }
    TEST_ASSERT_EQUAL(0, edges.last[0].r);
    TEST_ASSERT_FALSE(guard.pending());
}

// 19: an overlay added after the renderer still cannot pass the current ceiling
void test_an_overlay_after_the_renderer_cannot_exceed_the_ceiling() {
    FakeClock clock;
    FakeLedSink sink;
    OutputGuard guard(clock, sink);
    Rgb frame[180];
    for (auto &p : frame) {
        p = Rgb{255, 255, 255};  // an overlay that lights every LED white at full
    }
    guard.show(frame, 180);
    TEST_ASSERT_TRUE(estimateMilliamps(sink.last.data(), sink.last.size()) <= kLedCurrentCeilingMa);
    TEST_ASSERT_TRUE(sink.last[100].r > 0);  // and nothing was scaled to dark
    Rgb faint[180];
    for (auto &p : faint) {
        p = Rgb{1, 0, 0};
    }
    guard.show(faint, 180);
    TEST_ASSERT_TRUE(sink.last[100].r > 0 || sink.last[100].g > 0 || sink.last[100].b > 0);
}

void test_the_supply_rating_lowers_the_ceiling_and_never_raises_it() {
    TEST_ASSERT_EQUAL(2700, ledCeilingForSupply(5000));  // the board as specified
    TEST_ASSERT_EQUAL(2700, ledCeilingForSupply(6000));  // never above the board's own figure
    TEST_ASSERT_EQUAL(967, ledCeilingForSupply(3000));   // 3000 x 0.91 - 1763
    TEST_ASSERT_EQUAL(2696, ledCeilingForSupply(4900));  // 4900 x 0.91 - 1763
    TEST_ASSERT_EQUAL(2700, ledCeilingForSupply(5000));  // 5000 x 0.91 - 1763 = 2787 is capped
    TEST_ASSERT_EQUAL(512, ledCeilingForSupply(2500));   // the lowest setting
    TEST_ASSERT_EQUAL(1763, kOtherLoadsMa);              // the board's loads besides the LEDs, from their named figures
    TEST_ASSERT_EQUAL(0, ledCeilingForSupply(2400));     // not supported
    FakeClock clock;
    FakeLedSink sink;
    OutputGuard guard(clock, sink);
    guard.setSupplyCeiling(ledCeilingForSupply(3000));
    Rgb frame[180];
    for (auto &p : frame) {
        p = Rgb{255, 255, 255};
    }
    guard.show(frame, 180);
    TEST_ASSERT_TRUE(estimateMilliamps(sink.last.data(), 180) <= 967);
    guard.setSupplyCeiling(60000);  // a setting above the board's figure is clamped
    TEST_ASSERT_EQUAL(2700, guard.effectiveCeiling());
}

// `provision supply <mA>` is saved by the identity store and the guard is given the new ceiling straight away, the way
// main.cpp does it after every provision command: no restart and no change in the inlet is needed
void test_a_new_supply_setting_lowers_the_guards_ceiling_at_once() {
    FakeKv kv;
    IdentityStore store(kv);
    FakeClock clock;
    FakeLedSink sink;
    OutputGuard guard(clock, sink);
    const bool inletPresent = true;
    auto refresh = [&]() { guard.setSupplyCeiling(supplyCeilingFor(inletPresent, store.supplyMa())); };
    refresh();
    TEST_ASSERT_EQUAL(2700, guard.effectiveCeiling());  // unset: the board's own 5 A supply
    char reply[300];
    const char *line = "supply 3000";
    TEST_ASSERT_TRUE(handleProvisionCommand(store, line, strlen(line), reply, sizeof reply));
    refresh();
    TEST_ASSERT_EQUAL(967, guard.effectiveCeiling());
    Rgb frame[180];
    for (auto &p : frame) {
        p = Rgb{255, 255, 255};
    }
    for (int i = 0; i < 40; i++) {
        clock.advance(20);
        guard.show(frame, 180);
    }
    TEST_ASSERT_TRUE(estimateMilliamps(sink.last.data(), 180) <= 967);
    line = "supply 2000";  // refused: the ceiling stays where it was
    TEST_ASSERT_FALSE(handleProvisionCommand(store, line, strlen(line), reply, sizeof reply));
    refresh();
    TEST_ASSERT_EQUAL(967, guard.effectiveCeiling());
    TEST_ASSERT_EQUAL(0, supplyCeilingFor(false, store.supplyMa()));  // without the inlet it is 0 whatever the rating
}

// the audio ceiling: the lower of the two always wins and switching it never causes a flash
void test_the_audio_ceiling_is_the_lower_of_the_two_and_changing_it_never_flashes() {
    TEST_ASSERT_EQUAL(1200, kLedCeilingWithAudioMa);  // the board's figure
    FakeClock clock;
    EdgeSink edges(clock);
    OutputGuard guard(clock, edges);
    TEST_ASSERT_EQUAL(2700, guard.effectiveCeiling());
    guard.setAudioActive(true);
    TEST_ASSERT_EQUAL(1200, guard.effectiveCeiling());
    guard.setSupplyCeiling(967);  // a 3 A adapter is lower still: the lower one wins
    TEST_ASSERT_EQUAL(967, guard.effectiveCeiling());
    guard.setSupplyCeiling(2700);
    Rgb frame[180];
    for (auto &p : frame) {
        p = Rgb{255, 255, 255};
    }
    int risesBefore = 0;
    for (int t = 0; t < 3000; t++) {
        clock.advance(1);
        guard.setAudioActive((t / 100) % 2 == 0);  // audio starts and stops every 100 ms
        guard.show(frame, 180);
        bool want = true;
        for (size_t i = 0; i < 180; i++) {
            bool lit = (edges.last[i].r | edges.last[i].g | edges.last[i].b) != 0;
            TEST_ASSERT_TRUE(lit == want);  // dimmer, never dark
        }
        uint32_t ma = estimateMilliamps(edges.last.data(), 180);
        TEST_ASSERT_TRUE(ma <= ((t / 100) % 2 == 0 ? 1200u : 2700u));
        if (t == 0) {
            for (auto &v : edges.rises) risesBefore += (int)v.size();
        }
    }
    int rises = 0;
    for (auto &v : edges.rises) {
        rises += (int)v.size();
    }
    TEST_ASSERT_EQUAL(risesBefore, rises);  // no light went dark and came back
}

// the rail backstop: stepped, with hysteresis, only while audio runs and never a flash
void test_the_rail_backstop_lowers_the_ceiling_in_steps_with_hysteresis_and_never_flashes() {
    // the steps themselves: 4.47 V on the rail (2235 mV on the pin) and 4.37 V (2185 mV)
    TEST_ASSERT_EQUAL(0, railStepFor(0, 2500));
    TEST_ASSERT_EQUAL(0, railStepFor(0, 2300));  // 4.60 V: inside the error band, so nothing happens
    TEST_ASSERT_EQUAL(0, railStepFor(0, 2235));
    TEST_ASSERT_EQUAL(1, railStepFor(0, 2234));
    TEST_ASSERT_EQUAL(2, railStepFor(0, 2100));
    TEST_ASSERT_EQUAL(1, railStepFor(1, 2245));  // 10 mV above the entry level: no change yet
    TEST_ASSERT_EQUAL(0, railStepFor(1, 2285));  // 50 mV above it (100 mV on the rail): back
    TEST_ASSERT_EQUAL(2, railStepFor(2, 2230));  // stays in step 2 until 50 mV above its entry level
    TEST_ASSERT_EQUAL(1, railStepFor(2, 2235));
    // a reading that wobbles around the entry level does not make the ceiling chatter
    uint8_t step = 0;
    int changes = 0;
    for (int i = 0; i < 1000; i++) {
        uint8_t next = railStepFor(step, (uint16_t)(2235 + (i % 2 ? 20 : -20)));
        changes += next != step;
        step = next;
    }
    TEST_ASSERT_TRUE(changes <= 1);
    // in the guard, only while audio runs and the lower one always wins
    FakeClock clock;
    EdgeSink edges(clock);
    OutputGuard guard(clock, edges);
    guard.setRailPinMv(2000);  // a very low rail, but audio is off
    TEST_ASSERT_EQUAL(2700, guard.effectiveCeiling());
    guard.setAudioActive(true);
    TEST_ASSERT_EQUAL(600, guard.effectiveCeiling());
    guard.setRailPinMv(2400);
    TEST_ASSERT_EQUAL(1200, guard.effectiveCeiling());
    guard.setSupplyCeiling(500);  // a small adapter is lower than any step
    TEST_ASSERT_EQUAL(500, guard.effectiveCeiling());
    guard.setSupplyCeiling(2700);
    Rgb frame[180];
    for (auto &p : frame) {
        p = Rgb{255, 255, 255};
    }
    for (int t = 0; t < 2000; t++) {
        clock.advance(1);
        guard.setRailPinMv((uint16_t)(2150 + (t % 400)));  // the rail swings across the steps
        guard.show(frame, 180);
        for (size_t i = 0; i < 180; i++) {
            TEST_ASSERT_TRUE((edges.last[i].r | edges.last[i].g | edges.last[i].b) != 0);  // dimmer, never dark
        }
    }
    for (auto &v : edges.rises) {
        TEST_ASSERT_TRUE(v.size() <= 1);  // each light came on once and stayed on
    }
}

// the Listen case at 240 bpm on sixteenths, with the swing limit off and on: the same source, the same sink
static int listenSwings(bool limit) {
    static LessonStep steps[40];
    for (int i = 0; i < 40; i++) {
        steps[i] = LessonStep{(uint16_t)i, 1, {60}, 0};
    }
    Rig r;
    r.guard.setSwingLimit(limit);
    PracticeSettings ps;
    ps.bpm = 240;
    char msg[80];
    r.hub.engine().start(Mode::Listen, Lesson{steps, 40}, ps, 0, msg, sizeof msg);
    r.run(2600, [](Rig &, int) {});
    return r.edges.worstSwings();
}

void test_listen_at_240_bpm_swings_about_16_times_a_second_without_the_limit_and_at_most_3_with_it() {
    int without = listenSwings(false);
    int with = listenSwings(true);
    TEST_ASSERT_TRUE_MESSAGE(without > 3, "the source no longer swings, so this test proves nothing");
    TEST_ASSERT_TRUE(without >= 10);  // about 16 a second, counted at the strip
    TEST_ASSERT_TRUE(with <= 3);
    (void)kNoLimit;
}

// a hostile source that swaps one light between bright and dim every millisecond
void test_the_guard_holds_the_brighter_state_when_a_light_would_swing_too_fast() {
    FakeClock clock;
    EdgeSink edges(clock);
    OutputGuard guard(clock, edges);
    Rgb bright[4], dim[4];
    for (int i = 0; i < 4; i++) {
        bright[i] = Rgb{128, 75, 0};  // the amber guide at half master: relative luminance about 0.32
        dim[i] = Rgb{10, 5, 0};       // the dim upcoming light: about 0.02
    }
    for (int t = 0; t < 4000; t++) {
        clock.advance(1);
        guard.show(t % 2 ? bright : dim, 4);
        if (t % 2) {
            TEST_ASSERT_TRUE(edges.last[0].r >= 100);  // asked bright, so bright
        }
    }
    TEST_ASSERT_TRUE(edges.worstSwings() <= 3);
    // with the limit off the same source swings every other millisecond
    FakeClock clock2;
    EdgeSink edges2(clock2);
    OutputGuard guard2(clock2, edges2);
    guard2.setSwingLimit(false);
    guard2.setStripLimit(false);  // the strip rule would catch four lights swinging together too
    for (int t = 0; t < 4000; t++) {
        clock2.advance(1);
        guard2.show(t % 2 ? bright : dim, 4);
    }
    TEST_ASSERT_TRUE(edges2.worstSwings() > 100);
    // a slow change is not a swing: a 2 s ramp up and down is left alone
    FakeClock clock3;
    EdgeSink edges3(clock3);
    OutputGuard guard3(clock3, edges3);
    for (int t = 0; t < 8000; t++) {
        clock3.advance(1);
        int phase = t % 4000;
        int v = phase < 2000 ? phase * 128 / 2000 : (4000 - phase) * 128 / 2000;
        Rgb p{(uint8_t)v, (uint8_t)(v * 3 / 5), 0};
        if (v == 0) {
            p = Rgb{1, 0, 0};
        }
        guard3.show(&p, 1);
        TEST_ASSERT_TRUE(edges3.last[0].r == p.r);  // passed through unchanged
    }
}

// the red rule: no colour the firmware emits is saturated red, so the colour limit cannot be needed
void test_no_colour_the_renderer_emits_is_saturated_red() {
    // roles, hands, motion and monochrome, at several levels and master values
    for (int role = 0; role < 4; role++) {
        for (int left = 0; left < 2; left++) {
            for (int mono = 0; mono < 2; mono++) {
                for (int master : {255, 128, 40}) {
                    for (uint32_t age : {0u, 100u, 300u, 600u}) {
                        CueList list;
                        list.count = 1;
                        list.cue[0] = Cue{60, (LightRole)role, 0, left != 0, role == 3, 0};
                        Rgb px[88] = {};
                        RenderSettings rs;
                        rs.master = (uint8_t)master;
                        rs.monochrome = mono != 0;
                        renderFrame(kPiano, list, age, rs, px, 88);
                        const Rgb &p = px[60 - 21];
                        int sum = p.r + p.g + p.b;
                        if (sum > 30) {  // above the "kept lit" floor values
                            TEST_ASSERT_TRUE_MESSAGE(p.r * 100 < sum * 80, "a pixel is at least 80 per cent red");
                        }
                    }
                }
            }
        }
    }
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_the_jack_at_20_hz_never_flashes_more_than_three_times_a_second);
    RUN_TEST(test_usb_at_20_hz);
    RUN_TEST(test_a_bluetooth_host_toggling_48_guides_at_20_hz);
    RUN_TEST(test_listen_mode_at_240_bpm_on_sixteenths);
    RUN_TEST(test_wrong_notes_mashed_and_the_insecure_glow);
    RUN_TEST(test_the_guard_holds_a_light_lit_when_it_has_no_edge_to_spare);
    RUN_TEST(test_listen_at_240_bpm_swings_about_16_times_a_second_without_the_limit_and_at_most_3_with_it);
    RUN_TEST(test_the_guard_holds_the_brighter_state_when_a_light_would_swing_too_fast);
    RUN_TEST(test_no_colour_the_renderer_emits_is_saturated_red);
    RUN_TEST(test_an_overlay_after_the_renderer_cannot_exceed_the_ceiling);
    RUN_TEST(test_the_supply_rating_lowers_the_ceiling_and_never_raises_it);
    RUN_TEST(test_a_new_supply_setting_lowers_the_guards_ceiling_at_once);
    RUN_TEST(test_the_audio_ceiling_is_the_lower_of_the_two_and_changing_it_never_flashes);
    RUN_TEST(test_the_rail_backstop_lowers_the_ceiling_in_steps_with_hysteresis_and_never_flashes);
    return UNITY_END();
}
