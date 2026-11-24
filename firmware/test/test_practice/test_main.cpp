#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <vector>

#include "../support/fakes.h"
#include "hub.h"
#include "outputguard.h"
#include "practice.h"
#include "render.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static const KeyboardProfile kPiano{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false};

// C D E F G, one step a beat apart (4 sixteenths)
static const LessonStep kScale[] = {{0, 1, {60}, 0}, {4, 1, {62}, 0}, {8, 1, {64}, 0}, {12, 1, {65}, 0}, {16, 1, {67}, 0}};
static const Lesson kLesson{kScale, 5};

static NoteEvent on(uint8_t note, uint32_t t, uint8_t vel = 80) {
    return NoteEvent{t, note, vel, 0, NoteSource::UsbMidi};
}

static bool hasCue(const PracticeEngine &e, uint32_t now, LightRole role, uint8_t note) {
    CueList list;
    e.collect(now, list);
    for (size_t i = 0; i < list.count; i++) {
        if (list.cue[i].role == role && list.cue[i].note == note) {
            return true;
        }
    }
    return false;
}

void test_lessons_from_outside_are_bounded() {
    char msg[80];
    TEST_ASSERT_FALSE(validateLesson(Lesson{nullptr, 0}, msg, sizeof msg));
    LessonStep bad[] = {{0, 1, {128}, 0}};
    TEST_ASSERT_FALSE(validateLesson(Lesson{bad, 1}, msg, sizeof msg));
    LessonStep zero[] = {{0, 0, {}, 0}};
    TEST_ASSERT_FALSE(validateLesson(Lesson{zero, 1}, msg, sizeof msg));
    LessonStep five[] = {{0, 5, {1, 2, 3, 4}, 0}};
    TEST_ASSERT_FALSE(validateLesson(Lesson{five, 1}, msg, sizeof msg));
    LessonStep order[] = {{4, 1, {60}, 0}, {4, 1, {62}, 0}};
    TEST_ASSERT_FALSE(validateLesson(Lesson{order, 2}, msg, sizeof msg));
    TEST_ASSERT_FALSE(validateLesson(Lesson{kScale, 513}, msg, sizeof msg));
    TEST_ASSERT_TRUE(validateLesson(kLesson, msg, sizeof msg));
    PracticeEngine e;
    PracticeSettings s;
    s.bpm = 10;
    TEST_ASSERT_FALSE(e.start(Mode::Melody, kLesson, s, 0, msg, sizeof msg));
    s.bpm = 80;
    s.windowMs = 5;
    TEST_ASSERT_FALSE(e.start(Mode::Rhythm, kLesson, s, 0, msg, sizeof msg));
}

void test_melody_waits_for_the_right_note_for_as_long_as_it_takes() {
    PracticeEngine e;
    char msg[80];
    TEST_ASSERT_TRUE(e.start(Mode::Melody, kLesson, PracticeSettings(), 0, msg, sizeof msg));
    e.tick(3600000);  // an hour later nothing has moved on
    TEST_ASSERT_EQUAL(0, e.stepIndex());
    TEST_ASSERT_TRUE(hasCue(e, 3600000, LightRole::Guide, 60));
    TEST_ASSERT_TRUE(hasCue(e, 3600000, LightRole::Upcoming, 62));
    e.onNote(on(61, 3600001));  // wrong
    TEST_ASSERT_EQUAL(0, e.stepIndex());
    TEST_ASSERT_EQUAL(1, e.score().wrong);
    TEST_ASSERT_TRUE(hasCue(e, 3600002, LightRole::Wrong, 61));
    TEST_ASSERT_TRUE(hasCue(e, 3600002, LightRole::Guide, 60));  // the guide stays
    e.onNote(on(60, 3600100));
    TEST_ASSERT_EQUAL(1, e.stepIndex());
    TEST_ASSERT_TRUE(hasCue(e, 3600101, LightRole::Guide, 62));
    TEST_ASSERT_FALSE(hasCue(e, 3600101, LightRole::Guide, 60));
    for (uint8_t n : {62, 64, 65, 67}) {
        e.onNote(on(n, 3601000));
    }
    TEST_ASSERT_TRUE(e.phase() == Phase::Done);
    TEST_ASSERT_EQUAL(5, e.score().hits);
}

void test_melody_chord_in_any_order_and_note_off_does_not_count() {
    LessonStep chord[] = {{0, 3, {60, 64, 67}, 0}, {4, 1, {72}, 0}};
    PracticeEngine e;
    char msg[80];
    e.start(Mode::Melody, Lesson{chord, 2}, PracticeSettings(), 0, msg, sizeof msg);
    e.onNote(on(67, 10));
    e.onNote(on(60, 11, 0));  // a release, not a press
    TEST_ASSERT_EQUAL(0, e.stepIndex());
    e.onNote(on(64, 12));
    TEST_ASSERT_TRUE(hasCue(e, 13, LightRole::Guide, 60));
    e.onNote(on(60, 14));
    TEST_ASSERT_EQUAL(1, e.stepIndex());
}

// 120 bpm: a beat is 500 ms, four count-in beats then the steps every 500 ms
void test_rhythm_scores_hits_early_late_missed_and_wrong() {
    PracticeEngine e;
    char msg[80];
    PracticeSettings s;
    s.bpm = 120;
    s.windowMs = 200;
    TEST_ASSERT_TRUE(e.start(Mode::Rhythm, kLesson, s, 1000, msg, sizeof msg));
    TEST_ASSERT_TRUE(e.phase() == Phase::CountIn);
    TEST_ASSERT_EQUAL(4, e.countInRemaining(1000));
    // step 0 target is 1000 + 2000 = 3000
    e.tick(2500);
    TEST_ASSERT_EQUAL(1, e.countInRemaining(2500));
    e.tick(3000);
    TEST_ASSERT_TRUE(e.phase() == Phase::Running);
    e.onNote(on(60, 3040));  // 40 ms late: within half the window, so on time
    TEST_ASSERT_EQUAL(1, e.score().hits);
    e.onNote(on(62, 3350));  // target 3500: 150 ms early, beyond half the window
    TEST_ASSERT_EQUAL(1, e.score().early);
    e.onNote(on(64, 4160));  // target 4000: 160 ms late
    TEST_ASSERT_EQUAL(1, e.score().late);
    e.onNote(on(70, 4200));  // not in the piece
    TEST_ASSERT_EQUAL(1, e.score().wrong);
    e.onNote(on(65, 4000));  // out of time order: its window (target 4500) is not open, so wrong
    TEST_ASSERT_EQUAL(2, e.score().wrong);
    e.tick(4800);  // step 3 (65) target 4500 + 200 passed
    TEST_ASSERT_EQUAL(1, e.score().missed);
    e.tick(5800);  // step 4 (67) missed too
    TEST_ASSERT_EQUAL(2, e.score().missed);
    TEST_ASSERT_TRUE(e.phase() == Phase::Done);
}

void test_rhythm_is_only_accepting_inside_the_window() {
    PracticeEngine e;
    char msg[80];
    PracticeSettings s;
    s.bpm = 120;
    s.countInBeats = 0;
    e.start(Mode::Rhythm, kLesson, s, 0, msg, sizeof msg);
    e.onNote(on(60, 201));  // 201 ms after the target: outside a 200 ms window
    TEST_ASSERT_EQUAL(1, e.score().wrong);
    TEST_ASSERT_EQUAL(0, e.score().hits + e.score().late);
}

void test_listen_lights_each_step_in_time_and_finishes() {
    PracticeEngine e;
    char msg[80];
    PracticeSettings s;
    s.bpm = 120;
    e.start(Mode::Listen, kLesson, s, 0, msg, sizeof msg);
    TEST_ASSERT_TRUE(hasCue(e, 10, LightRole::Guide, 60));
    TEST_ASSERT_TRUE(hasCue(e, 10, LightRole::Upcoming, 62));
    TEST_ASSERT_TRUE(hasCue(e, 520, LightRole::Guide, 62));
    TEST_ASSERT_FALSE(hasCue(e, 520, LightRole::Guide, 60));
    TEST_ASSERT_FALSE(hasCue(e, 480, LightRole::Guide, 60));  // the dark gap before the next step
    e.onNote(on(61, 600));                                    // playing along is echoed, never scored
    TEST_ASSERT_EQUAL(0, e.score().wrong);
    e.tick(2600);
    TEST_ASSERT_TRUE(e.phase() == Phase::Done);
}

void test_the_millisecond_counter_wrapping_changes_nothing() {
    PracticeEngine e;
    char msg[80];
    PracticeSettings s;
    s.bpm = 120;
    s.countInBeats = 0;
    uint32_t start = 0xFFFFFFFFu - 700;
    e.start(Mode::Rhythm, kLesson, s, start, msg, sizeof msg);
    e.onNote(on(60, start + 20));
    e.onNote(on(62, start + 520));  // this timestamp has wrapped past zero
    TEST_ASSERT_EQUAL(2, e.score().hits);
}

// ----- the second signal for every meaning -----

static std::vector<int> trace(LightRole role, bool blink, bool reduced, bool left = false) {
    std::vector<int> out;
    Cue cue{60, role, 0, left, blink, 0};
    for (uint32_t t = 0; t < 2000; t += 10) {
        CueList list;
        list.count = 1;
        list.cue[0] = cue;
        Rgb px[88] = {};
        RenderSettings rs;
        rs.monochrome = true;  // colour removed: what is left must still tell roles apart
        rs.reducedMotion = reduced;
        rs.master = 255;
        renderFrame(kPiano, list, t, rs, px, 88);
        out.push_back(px[60 - 21].g);
    }
    return out;
}

void test_every_role_differs_without_colour_in_both_motion_settings() {
    for (int reduced = 0; reduced < 2; reduced++) {
        std::vector<int> t[5] = {trace(LightRole::Played, false, reduced), trace(LightRole::Guide, false, reduced),
                                 trace(LightRole::Upcoming, false, reduced),
                                 trace(LightRole::Wrong, !reduced, reduced),
                                 trace(LightRole::Guide, false, reduced, true)};  // the left hand's guide
        for (int a = 0; a < 5; a++) {
            for (int b = a + 1; b < 5; b++) {
                TEST_ASSERT_TRUE_MESSAGE(t[a] != t[b], "two meanings look the same in greyscale");
            }
        }
    }
}

// the colours are the Studio's light language: amber right hand and next note, blue left hand, rose-magenta wrong
void test_final_light_colours_and_currents() {
    auto lit = [&](LightRole role, bool left, bool blink) {
        CueList list;
        list.count = 1;
        list.cue[0] = Cue{60, role, 0, left, blink, 0};
        Rgb px[88] = {};
        RenderSettings rs;
        rs.master = 255;
        renderFrame(kPiano, list, 0, rs, px, 88);
        return px[60 - 21];
    };
    Rgb right = lit(LightRole::Guide, false, false);
    TEST_ASSERT_EQUAL(255, right.r);
    TEST_ASSERT_EQUAL(150, right.g);
    TEST_ASSERT_EQUAL(0, right.b);
    Rgb left = lit(LightRole::Guide, true, false);  // blue at 70 percent
    TEST_ASSERT_EQUAL(0, left.r);
    TEST_ASSERT_EQUAL(76, left.g);
    TEST_ASSERT_EQUAL(178, left.b);
    Rgb wrong = lit(LightRole::Wrong, false, false);
    TEST_ASSERT_EQUAL(255, wrong.r);
    TEST_ASSERT_EQUAL(0, wrong.g);
    TEST_ASSERT_EQUAL(160, wrong.b);
    // full drive currents at 20 mA a channel and 1 mA idle: amber 405 x 20 / 255 + 1 = 32, blue 365 -> 29, rose-magenta 415 -> 33
    Rgb amber{255, 150, 0}, blue{0, 110, 255}, rose{255, 0, 160};
    TEST_ASSERT_EQUAL(32, (int)estimateMilliamps(&amber, 1));
    TEST_ASSERT_EQUAL(29, (int)estimateMilliamps(&blue, 1));
    TEST_ASSERT_EQUAL(33, (int)estimateMilliamps(&rose, 1));
}

void test_a_right_note_puts_its_light_out_and_the_next_comes_on() {
    PracticeEngine e;
    char msg[80];
    e.start(Mode::Melody, kLesson, PracticeSettings(), 0, msg, sizeof msg);
    TEST_ASSERT_TRUE(hasCue(e, 1, LightRole::Guide, 60));
    e.onNote(on(60, 10));
    TEST_ASSERT_FALSE(hasCue(e, 11, LightRole::Guide, 60));
    TEST_ASSERT_FALSE(hasCue(e, 11, LightRole::Played, 60));  // nothing replaces it
    TEST_ASSERT_TRUE(hasCue(e, 11, LightRole::Guide, 62));
}

void test_the_left_hand_notes_of_a_step_are_blue_cues() {
    static const LessonStep both[] = {{0, 2, {48, 64}, 0x01}};  // note 0 (48) left, note 1 (64) right
    PracticeEngine e;
    char msg[80];
    e.start(Mode::Melody, Lesson{both, 1}, PracticeSettings(), 0, msg, sizeof msg);
    CueList list;
    e.collect(1, list);
    TEST_ASSERT_EQUAL(2, (int)list.count);
    for (size_t i = 0; i < list.count; i++) {
        TEST_ASSERT_EQUAL(list.cue[i].note == 48, list.cue[i].left);
    }
}

// the worst frame again, with the new colours
void test_ceiling_with_the_new_colours() {
    Rgb px[180];
    for (auto &p : px) {
        p = Rgb{255, 0, 160};  // every LED the wrong-note colour at full: 6038 mA
    }
    TEST_ASSERT_EQUAL(6038, (int)estimateMilliamps(px, 180));  // 180 x 415 x 20 / 255 + 180 idle
    uint16_t scale = applyCeiling(px, 180, kLedCurrentCeilingMa);
    TEST_ASSERT_TRUE(scale < 256);
    TEST_ASSERT_TRUE(estimateMilliamps(px, 180) <= 2700);
    TEST_ASSERT_TRUE(estimateMilliamps(px, 180) > 2500);
    for (auto &p : px) {
        p = Rgb{255, 150, 0};  // the amber guide on every LED: 5897 mA
    }
    applyCeiling(px, 180, kLedCurrentCeilingMa);
    TEST_ASSERT_TRUE(estimateMilliamps(px, 180) <= 2700);
}

void test_reduced_motion_removes_all_animation() {
    for (LightRole r : {LightRole::Played, LightRole::Guide, LightRole::Upcoming}) {
        std::vector<int> t = trace(r, false, true);
        for (int v : t) {
            TEST_ASSERT_EQUAL(t[0], v);  // a steady level for as long as the cue lives
        }
    }
    // wrong: one steady stretch then dark, never on-off-on
    std::vector<int> w = trace(LightRole::Wrong, false, true);
    int edges = 0;
    for (size_t i = 1; i < w.size(); i++) {
        edges += (w[i] > 0) != (w[i - 1] > 0);
    }
    TEST_ASSERT_EQUAL(1, edges);
    TEST_ASSERT_TRUE(w[0] > 0);
}

void test_wrong_blink_is_two_flashes_at_two_hertz() {
    std::vector<int> w = trace(LightRole::Wrong, true, false);
    int rising = 0;
    for (size_t i = 0; i < w.size(); i++) {
        rising += w[i] > 0 && (i == 0 || w[i - 1] == 0);
    }
    TEST_ASSERT_EQUAL(2, rising);
    TEST_ASSERT_EQUAL(0, w[190]);  // dark after 750 ms
}

// the global limit: however fast keys are mashed, flashes stay at 2 a second
void test_mashing_wrong_keys_never_flashes_faster_than_two_a_second() {
    for (int reduced = 0; reduced < 2; reduced++) {
        for (int gap : {5, 37, 100, 250, 333, 499, 700, 999}) {
            PracticeEngine e;
            char msg[80];
            PracticeSettings s;
            s.reducedMotion = reduced;
            e.start(Mode::Melody, kLesson, s, 0, msg, sizeof msg);
            std::vector<uint8_t> lit;
            for (uint32_t t = 0; t < 8000; t++) {
                if (t % gap == 0) {
                    e.onNote(on((uint8_t)(70 + (t / gap) % 20), t));
                }
                e.tick(t);
                CueList list;
                e.collect(t, list);
                Rgb px[88];
                RenderSettings rs;
                rs.reducedMotion = reduced;
                rs.master = 255;
                renderFrame(kPiano, list, t, rs, px, 88);
                bool red = false;
                for (int i = 0; i < 88; i++) {
                    red = red || (px[i].r > 0 && px[i].b > 0);  // the wrong colour is the only one with both
                }
                lit.push_back(red);
            }
            for (size_t t = 1000; t < lit.size(); t++) {
                int rising = 0;
                for (size_t k = t - 999; k <= t; k++) {
                    rising += lit[k] && !lit[k - 1];
                }
                char m[80];
                snprintf(m, sizeof m, "flashes %d gap %d reduced %d t %d", rising, gap, reduced, (int)t);
                TEST_ASSERT_TRUE_MESSAGE(rising <= 2, m);
            }
        }
    }
}

void test_wrong_light_is_never_on_a_guide_key() {
    PracticeEngine e;
    char msg[80];
    e.start(Mode::Melody, kLesson, PracticeSettings(), 0, msg, sizeof msg);
    uint32_t t = 10;
    int wrongSeen = 0;
    for (int note = 0; note < 128; note++) {
        t += 2000;  // far enough apart that each wrong note is lit
        e.onNote(on((uint8_t)note, t));
        e.tick(t + 1);
        CueList list;
        e.collect(t + 1, list);
        for (size_t i = 0; i < list.count; i++) {
            if (list.cue[i].role != LightRole::Wrong) {
                continue;
            }
            wrongSeen++;
            for (size_t k = 0; k < list.count; k++) {
                if (list.cue[k].role == LightRole::Guide) {
                    TEST_ASSERT_TRUE(list.cue[k].note != list.cue[i].note);
                }
            }
        }
    }
    TEST_ASSERT_TRUE(wrongSeen >= 60);  // 60 notes below the first guide alone are wrong: the check really ran
}

void test_a_wrong_note_inside_the_gap_is_scored_but_not_lit() {
    PracticeEngine e;
    char msg[80];
    e.start(Mode::Melody, kLesson, PracticeSettings(), 0, msg, sizeof msg);
    e.onNote(on(70, 100));
    e.onNote(on(71, 600));  // 500 ms later: a blinking warning allows the next one only after 1000 ms
    TEST_ASSERT_EQUAL(2, e.score().wrong);
    TEST_ASSERT_EQUAL(1, e.score().wrongUnlit);
    TEST_ASSERT_FALSE(hasCue(e, 601, LightRole::Wrong, 71));
    e.onNote(on(72, 1100));  // exactly 1000 ms after the first
    TEST_ASSERT_TRUE(hasCue(e, 1101, LightRole::Wrong, 72));
    TEST_ASSERT_EQUAL(1, e.score().wrongUnlit);
}

void test_approach_dot_hops_at_most_twice_a_second_and_stops_with_reduced_motion() {
    for (int reduced = 0; reduced < 2; reduced++) {
        PracticeEngine e;
        char msg[80];
        PracticeSettings s;
        s.bpm = 60;
        s.countInBeats = 0;
        s.reducedMotion = reduced;
        LessonStep one[] = {{16, 1, {60}, 0}};  // target at 4000 ms
        e.start(Mode::Rhythm, Lesson{one, 1}, s, 0, msg, sizeof msg);
        int hops = 0;
        int lastLead = -1;
        for (uint32_t t = 0; t < 4000; t += 5) {
            CueList list;
            e.collect(t, list);
            for (size_t i = 0; i < list.count; i++) {
                if (list.cue[i].role == LightRole::Upcoming) {
                    if (lastLead >= 0 && list.cue[i].lead != lastLead) {
                        hops++;
                    }
                    lastLead = list.cue[i].lead;
                }
            }
        }
        if (reduced) {
            TEST_ASSERT_EQUAL(0, hops);
        } else {
            TEST_ASSERT_TRUE(hops >= 2 && hops <= 3);  // 1500 ms of approach, a hop each 500 ms
        }
    }
}

// ----- power -----

void test_ceiling_holds_for_the_worst_frame() {
    Rgb px[180];
    for (auto &p : px) {
        p = Rgb{255, 255, 255};
    }
    TEST_ASSERT_EQUAL(180 * 60 + 180, (int)estimateMilliamps(px, 180) - 0);  // 10,980 mA unlimited
    uint16_t scale = applyCeiling(px, 180, kLedCurrentCeilingMa);
    TEST_ASSERT_TRUE(scale < 256 && scale > 0);
    TEST_ASSERT_TRUE(estimateMilliamps(px, 180) <= 2700);
    // and close to it: the limiter must not throw brightness away
    TEST_ASSERT_TRUE(estimateMilliamps(px, 180) > 2500);
}

void test_ceiling_leaves_ordinary_frames_alone_and_holds_for_random_ones() {
    Rgb one[180] = {};
    one[10] = Rgb{0, 90, 255};
    Rgb copy[180];
    memcpy(copy, one, sizeof one);
    TEST_ASSERT_EQUAL(256, applyCeiling(one, 180, kLedCurrentCeilingMa));
    TEST_ASSERT_EQUAL_MEMORY(copy, one, sizeof one);
    uint32_t seed = 12345;
    for (int round = 0; round < 2000; round++) {
        Rgb px[180];
        int count = 1 + (int)(seed >> 8) % 180;
        for (int i = 0; i < count; i++) {
            seed = seed * 1664525u + 1013904223u;
            px[i] = Rgb{(uint8_t)(seed >> 24), (uint8_t)(seed >> 16), (uint8_t)(seed >> 8)};
        }
        uint16_t ceiling = (uint16_t)(200 + (seed >> 4) % 3800);
        applyCeiling(px, (size_t)count, ceiling);
        if (ceiling > count) {
            TEST_ASSERT_TRUE(estimateMilliamps(px, (size_t)count) <= ceiling);
        }
    }
    // a ceiling below the idle draw gives a dark frame, never an over-limit one
    Rgb dark[180];
    for (auto &p : dark) {
        p = Rgb{255, 255, 255};
    }
    TEST_ASSERT_EQUAL(0, applyCeiling(dark, 180, 100));
    TEST_ASSERT_EQUAL(0, dark[5].g);
}

void test_every_role_at_full_master_fits_the_ceiling_with_a_chord_of_ten() {
    CueList list;
    list.count = 0;
    for (uint8_t n = 60; n < 70; n++) {
        list.cue[list.count++] = Cue{n, LightRole::Wrong, 0, false, false, 0};
    }
    Rgb px[88];
    RenderSettings rs;
    rs.master = 255;
    renderFrame(kPiano, list, 10, rs, px, 88);
    TEST_ASSERT_TRUE(estimateMilliamps(px, 88) <= 2700);
}

// ----- timing against a fake clock -----

void test_key_press_reaches_the_light_in_one_loop_pass_plus_the_strip_time() {
    FakeClock clock;
    FakeLedSink sink(&clock, 6);  // 180 LEDs: 5.4 ms of data and the reset gap
    NoteBus bus;
    PracticeHub hub(clock, sink, bus, 88);
    hub.setProfile(kPiano);
    hub.step();  // first frame
    uint32_t seed = 7;
    for (int press = 0; press < 200; press++) {
        seed = seed * 1664525u + 1013904223u;
        clock.advance(1 + (seed >> 24) % 40);
        uint32_t pressedAt = clock.nowMs();
        uint8_t key = (uint8_t)(21 + (seed >> 8) % 88);
        bus.push(on(key, pressedAt));
        uint32_t before = hub.framesShown();
        hub.step();  // the loop's very next pass
        // the frame was handed to the strip in that same pass: the logic adds no delay of its own
        TEST_ASSERT_EQUAL_MESSAGE(before + 1, hub.framesShown(), "the press did not light in the next pass");
        TEST_ASSERT_EQUAL(0, (int)(hub.lastShowMs() - pressedAt));
        // and the strip is latched after its own 6 ms: 6 ms in all, inside the 7 ms budget
        TEST_ASSERT_EQUAL(6, (int)(clock.nowMs() - pressedAt));
        // the lit key is the one pressed
        int index = ledIndexForNote(kPiano, key);
        TEST_ASSERT_TRUE(sink.last[(size_t)index].r > 0 || sink.last[(size_t)index].g > 0);
        clock.advance(300);
        bus.push(on(key, clock.nowMs(), 0));
        hub.step();
    }
}

void test_a_burst_is_drained_in_bounded_passes_and_overflow_is_counted() {
    FakeClock clock;
    FakeLedSink sink(&clock, 6);
    NoteBus bus;
    PracticeHub hub(clock, sink, bus, 88);
    hub.setProfile(kPiano);
    for (int i = 0; i < 300; i++) {
        bus.push(on((uint8_t)(21 + i % 88), 0));
    }
    TEST_ASSERT_TRUE(bus.dropped() > 0);  // 255 fit
    int passes = 0;
    while (bus.size() > 0) {
        hub.step();
        passes++;
    }
    TEST_ASSERT_TRUE(passes <= 8);  // 255 events at 32 a pass
    TEST_ASSERT_TRUE(sink.shows >= 1);
}

void test_the_ceiling_is_the_boards_figure_and_the_last_step_before_the_strip() {
    TEST_ASSERT_EQUAL(2700, kLedCurrentCeilingMa);
    FakeClock clock;
    FakeLedSink sink;
    OutputGuard guard(clock, sink);  // the ceiling lives in the sink
    NoteBus bus;
    PracticeHub hub(clock, guard, bus, 88);
    hub.setProfile(kPiano);
    RenderSettings rs;
    rs.master = 255;
    rs.monochrome = true;
    rs.ceilingMa = 60000;  // a setting cannot raise the board's ceiling
    hub.setRender(rs);
    GuideSet guides;
    for (uint8_t n = 30; n < 90; n++) {
        guides.set(n, true);  // 60 white lights at full: about 3.7 A unlimited
    }
    hub.engine().setExternalGuides(&guides);
    hub.setInsecure(true);
    hub.step();
    TEST_ASSERT_TRUE(sink.last.size() == 88);
    TEST_ASSERT_TRUE(estimateMilliamps(sink.last.data(), sink.last.size()) <= 2700);
    TEST_ASSERT_TRUE(estimateMilliamps(sink.last.data(), sink.last.size()) > 2400);  // and not needlessly dim
}

void test_unchanged_frames_are_not_pushed_to_the_strip() {
    FakeClock clock;
    FakeLedSink sink(&clock, 6);
    NoteBus bus;
    PracticeHub hub(clock, sink, bus, 88);
    hub.setProfile(kPiano);
    hub.step();
    int shows = sink.shows;
    for (int i = 0; i < 100; i++) {
        clock.advance(1);
        hub.step();
    }
    TEST_ASSERT_EQUAL(shows, sink.shows);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_lessons_from_outside_are_bounded);
    RUN_TEST(test_melody_waits_for_the_right_note_for_as_long_as_it_takes);
    RUN_TEST(test_melody_chord_in_any_order_and_note_off_does_not_count);
    RUN_TEST(test_rhythm_scores_hits_early_late_missed_and_wrong);
    RUN_TEST(test_rhythm_is_only_accepting_inside_the_window);
    RUN_TEST(test_listen_lights_each_step_in_time_and_finishes);
    RUN_TEST(test_the_millisecond_counter_wrapping_changes_nothing);
    RUN_TEST(test_every_role_differs_without_colour_in_both_motion_settings);
    RUN_TEST(test_final_light_colours_and_currents);
    RUN_TEST(test_a_right_note_puts_its_light_out_and_the_next_comes_on);
    RUN_TEST(test_the_left_hand_notes_of_a_step_are_blue_cues);
    RUN_TEST(test_ceiling_with_the_new_colours);
    RUN_TEST(test_reduced_motion_removes_all_animation);
    RUN_TEST(test_wrong_blink_is_two_flashes_at_two_hertz);
    RUN_TEST(test_mashing_wrong_keys_never_flashes_faster_than_two_a_second);
    RUN_TEST(test_wrong_light_is_never_on_a_guide_key);
    RUN_TEST(test_a_wrong_note_inside_the_gap_is_scored_but_not_lit);
    RUN_TEST(test_approach_dot_hops_at_most_twice_a_second_and_stops_with_reduced_motion);
    RUN_TEST(test_ceiling_holds_for_the_worst_frame);
    RUN_TEST(test_ceiling_leaves_ordinary_frames_alone_and_holds_for_random_ones);
    RUN_TEST(test_every_role_at_full_master_fits_the_ceiling_with_a_chord_of_ten);
    RUN_TEST(test_key_press_reaches_the_light_in_one_loop_pass_plus_the_strip_time);
    RUN_TEST(test_a_burst_is_drained_in_bounded_passes_and_overflow_is_counted);
    RUN_TEST(test_the_ceiling_is_the_boards_figure_and_the_last_step_before_the_strip);
    RUN_TEST(test_unchanged_frames_are_not_pushed_to_the_strip);
    return UNITY_END();
}
