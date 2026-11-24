// the rotary encoder's two decoders. Awaits a board: nothing here has seen a real encoder.
#include <unity.h>
#include <cstdio>

#include <vector>

#include "encoder.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

// a code is (A << 1) | B
static int feedCode(QuadratureDecoder &d, int code) {
    return d.feed(code & 2, code & 1);
}
static int feedAll(QuadratureDecoder &d, const std::vector<int> &codes) {
    int sum = 0;
    for (int c : codes) {
        sum += feedCode(d, c);
    }
    return sum;
}

static const std::vector<int> kCw = {2, 0, 1, 3};
static const std::vector<int> kCcw = {1, 0, 2, 3};

void test_every_full_cycle_counts_one_detent_in_its_direction() {
    QuadratureDecoder d;
    feedCode(d, 3);  // the first sample is only the starting state: at rest
    int total = 0;
    for (int i = 0; i < 10; i++) {
        total += feedAll(d, kCw);
    }
    TEST_ASSERT_EQUAL(10, total);
    for (int i = 0; i < 7; i++) {
        total += feedAll(d, kCcw);
    }
    TEST_ASSERT_EQUAL(3, total);
    TEST_ASSERT_EQUAL(0, (int)d.illegal());
}

void test_the_count_comes_at_the_detent_not_before() {
    QuadratureDecoder d;
    feedCode(d, 3);  // the first sample is only the starting state: at rest
    TEST_ASSERT_EQUAL(0, feedCode(d, 2));
    TEST_ASSERT_EQUAL(0, feedCode(d, 0));
    TEST_ASSERT_EQUAL(0, feedCode(d, 1));
    TEST_ASSERT_EQUAL(1, feedCode(d, 3));
}

void test_bounce_and_a_half_turn_that_comes_back_count_nothing() {
    QuadratureDecoder d;
    feedCode(d, 3);  // the first sample is only the starting state: at rest
    TEST_ASSERT_EQUAL(0, feedAll(d, {2, 3, 2, 3, 2, 3}));      // bounce on the first contact
    TEST_ASSERT_EQUAL(0, feedAll(d, {2, 0, 2, 3}));            // half way and back
    TEST_ASSERT_EQUAL(0, feedAll(d, {1, 0, 1, 3}));            // the other way
    TEST_ASSERT_EQUAL(0, feedAll(d, {2, 0, 1, 0, 1, 0, 2, 3})); // wobble at the middle, ending back where it came from
    TEST_ASSERT_EQUAL(1, feedAll(d, kCw));                      // and it still counts a real detent after all that
}

void test_a_bounce_in_the_middle_of_a_real_turn_does_not_add_or_lose_a_count() {
    QuadratureDecoder d;
    feedCode(d, 3);  // the first sample is only the starting state: at rest
    TEST_ASSERT_EQUAL(1, feedAll(d, {2, 0, 2, 0, 1, 0, 1, 3}));  // wobbles but still one clockwise detent
    TEST_ASSERT_EQUAL(-1, feedAll(d, {1, 3, 1, 0, 2, 0, 2, 3}));
}

void test_an_illegal_transition_counts_nothing_until_the_encoder_is_next_at_rest() {
    QuadratureDecoder d;
    feedCode(d, 3);  // the first sample is only the starting state: at rest
    TEST_ASSERT_EQUAL(0, feedCode(d, 0));  // 11 to 00 in one sample: both phases changed
    TEST_ASSERT_EQUAL(1, (int)d.illegal());
    TEST_ASSERT_TRUE(d.lost());
    TEST_ASSERT_EQUAL(0, feedAll(d, {1, 3}));  // the rest of that turn is not counted
    TEST_ASSERT_FALSE(d.lost());
    TEST_ASSERT_EQUAL(1, feedAll(d, kCw));
    // an illegal jump in the middle of a turn abandons it
    QuadratureDecoder e;
    feedCode(e, 3);  // the first sample is only the starting state: at rest
    TEST_ASSERT_EQUAL(0, feedAll(e, {2, 0, 2 /* back */, 1 /* 10 to 01 */, 0, 2, 3}));
    TEST_ASSERT_TRUE(e.illegal() >= 1);
    TEST_ASSERT_EQUAL(1, feedAll(e, kCw));
}

// proof: starting one bit from rest counted a full detent after three quarter steps
void test_a_start_away_from_rest_counts_nothing_until_rest_has_been_seen_once() {
    for (int first : {0, 1, 2}) {
        QuadratureDecoder d;
        // from the first sample the rest of a turn that began before the hub started
        std::vector<int> turn = first == 2 ? std::vector<int>{2, 0, 1, 3} : first == 1 ? std::vector<int>{1, 0, 2, 3} : std::vector<int>{0, 1, 3};
        TEST_ASSERT_EQUAL_MESSAGE(0, feedAll(d, turn), "a turn that began before start-up was counted");
        TEST_ASSERT_EQUAL(1, feedAll(d, kCw));   // and rest seen once, counting works
        TEST_ASSERT_EQUAL(-1, feedAll(d, kCcw));
    }
    QuadratureDecoder e;
    TEST_ASSERT_EQUAL(0, feedAll(e, {3, 3, 3}));  // a start at rest is just the start
    TEST_ASSERT_EQUAL(1, feedAll(e, kCw));
}

// every sequence of up to 9 samples, checked against an oracle written differently. It follows the rule in the
// header: from rest, the net number of clockwise steps must reach exactly +4 (or -4) by the time the encoder is
// back at rest, with no illegal step and no excursion beyond 4 either way on the way
void test_every_short_sample_sequence_agrees_with_the_oracle() {
    long checked = 0;
    const int order[4] = {3, 2, 0, 1};  // the clockwise cycle by position
    auto pos = [&](int code) {
        for (int i = 0; i < 4; i++) if (order[i] == code) return i;
        return 0;
    };
    for (int length = 1; length <= 9; length++) {
        long total = 1;
        for (int i = 0; i < length; i++) total *= 4;
        for (long n = 0; n < total; n++) {
            QuadratureDecoder d;
            long v = n;
            int last = 3;
            int net = 0;
            bool dead = false;  // abandoned: nothing counts until rest
            for (int i = 0; i < length; i++) {
                int code = (int)(v & 3);
                v >>= 2;
                int got = feedCode(d, code);
                int expect = 0;
                if (i == 0) {
                    last = code;  // the first sample is only the starting state
                    dead = code != 3;
                } else if (code != last) {
                    if ((code ^ last) == 3) {
                        dead = code != 3;
                        net = 0;
                    } else if (dead) {
                        if (code == 3) dead = false;
                        net = 0;
                    } else {
                        int delta = (pos(code) - pos(last) + 4) % 4 == 1 ? 1 : -1;
                        net += delta;
                        if (code == 3) {
                            expect = net == 4 ? 1 : net == -4 ? -1 : 0;
                            net = 0;
                        } else if (net > 4 || net < -4) {
                            net = 0;
                            dead = true;
                        }
                    }
                    last = code;
                }
                if (got != expect) {
                    char msg[80];
                    snprintf(msg, sizeof msg, "sequence %ld length %d step %d: got %d expected %d", n, length, i, got, expect);
                    TEST_FAIL_MESSAGE(msg);
                }
                checked++;
            }
        }
    }
    TEST_ASSERT_TRUE(checked > 1000000);
}

// ---------- the switch ----------

static SwitchEvent hold(DebouncedSwitch &s, bool level, uint32_t fromMs, uint32_t toMs, SwitchEvent &first) {
    SwitchEvent last = SwitchEvent::None;
    first = SwitchEvent::None;
    for (uint32_t t = fromMs; t <= toMs; t++) {
        SwitchEvent e = s.feed(level, t);
        if (e != SwitchEvent::None) {
            if (first == SwitchEvent::None) first = e;
            last = e;
        }
    }
    return last;
}

void test_a_short_press_gives_one_press_on_release_and_a_long_press_gives_one_long_press() {
    DebouncedSwitch s;  // low means pressed
    SwitchEvent first;
    hold(s, true, 0, 100, first);
    TEST_ASSERT_TRUE(first == SwitchEvent::None);
    // pressed for 300 ms
    TEST_ASSERT_TRUE(hold(s, false, 101, 400, first) == SwitchEvent::None);
    TEST_ASSERT_TRUE(s.pressed());
    TEST_ASSERT_TRUE(hold(s, true, 401, 500, first) == SwitchEvent::Press);
    TEST_ASSERT_FALSE(s.pressed());
    // pressed for 1.5 s: one LongPress while it is down and nothing on release
    int longs = 0, presses = 0;
    for (uint32_t t = 600; t <= 2100; t++) {
        SwitchEvent e = s.feed(false, t);
        longs += e == SwitchEvent::LongPress;
        presses += e == SwitchEvent::Press;
    }
    TEST_ASSERT_EQUAL(1, longs);
    for (uint32_t t = 2101; t <= 2300; t++) {
        presses += s.feed(true, t) == SwitchEvent::Press;
    }
    TEST_ASSERT_EQUAL(0, presses);
}

void test_contact_bounce_shorter_than_the_debounce_time_is_ignored() {
    DebouncedSwitch s;
    int events = 0;
    uint32_t t = 0;
    for (; t < 100; t++) events += s.feed(true, t) != SwitchEvent::None;
    // bounces of 1 to 5 ms on press
    bool level = true;
    for (int i = 0; i < 8; i++) {
        level = !level;
        for (int k = 0; k < 1 + i % 5; k++) events += s.feed(level, t++) != SwitchEvent::None;
    }
    TEST_ASSERT_EQUAL(0, events);
    TEST_ASSERT_FALSE(s.pressed());
    // a glitch of 19 ms on an idle line never registers, 20 ms does
    for (int k = 0; k < 19; k++) s.feed(false, t++);
    for (int k = 0; k < 50; k++) events += s.feed(true, t++) != SwitchEvent::None;
    TEST_ASSERT_EQUAL(0, events);
    for (int k = 0; k < 25; k++) s.feed(false, t++);
    TEST_ASSERT_TRUE(s.pressed());
}

void test_a_press_just_under_and_just_over_the_long_press_time() {
    for (int over = 0; over < 2; over++) {
        DebouncedSwitch s;
        SwitchEvent first;
        hold(s, true, 0, 50, first);
        uint32_t downFor = DebouncedSwitch::kLongMs + (over ? 30 : -30);
        int longs = 0, presses = 0;
        uint32_t t = 51;
        for (uint32_t i = 0; i < downFor + DebouncedSwitch::kDebounceMs; i++, t++) {
            SwitchEvent e = s.feed(false, t);
            longs += e == SwitchEvent::LongPress;
            presses += e == SwitchEvent::Press;
        }
        for (uint32_t i = 0; i < 100; i++, t++) {
            SwitchEvent e = s.feed(true, t);
            longs += e == SwitchEvent::LongPress;
            presses += e == SwitchEvent::Press;
        }
        TEST_ASSERT_EQUAL(over ? 1 : 0, longs);
        TEST_ASSERT_EQUAL(over ? 0 : 1, presses);
    }
}

// proof: a switch held or stuck low at power-up gave a long press after about 820 ms
void test_a_switch_down_at_power_up_gives_no_press_and_no_long_press_until_it_has_been_released() {
    DebouncedSwitch s;
    int events = 0;
    uint32_t t = 0;
    for (; t < 5000; t++) events += s.feed(false, t) != SwitchEvent::None;  // stuck low for 5 s
    TEST_ASSERT_EQUAL_MESSAGE(0, events, "a switch stuck low at start-up reported something");
    for (int k = 0; k < 100; k++, t++) events += s.feed(true, t) != SwitchEvent::None;  // released
    TEST_ASSERT_EQUAL_MESSAGE(0, events, "its release reported a press");
    // now a real press counts
    for (int k = 0; k < 200; k++, t++) s.feed(false, t);
    int presses = 0;
    for (int k = 0; k < 100; k++, t++) presses += s.feed(true, t) == SwitchEvent::Press;
    TEST_ASSERT_EQUAL(1, presses);
    // pressed, released, then held at start-up in a second run is the same
    DebouncedSwitch u;
    int more = 0;
    for (uint32_t k = 0; k < 100; k++) more += u.feed(false, k) != SwitchEvent::None;
    for (uint32_t k = 100; k < 300; k++) more += u.feed(true, k) != SwitchEvent::None;
    TEST_ASSERT_EQUAL(0, more);
}

// proof: a low shorter than the debounce time at the first sample left the ignore flag set, so the next
// real press gave nothing
void test_a_glitch_at_start_up_does_not_swallow_the_next_real_press() {
    DebouncedSwitch s;
    int presses = 0, longs = 0;
    uint32_t t = 0;
    for (; t < 5; t++) s.feed(false, t);  // 5 ms low at the first samples: a glitch
    for (; t < 300; t++) {
        SwitchEvent e = s.feed(true, t);
        presses += e == SwitchEvent::Press;
        longs += e == SwitchEvent::LongPress;
    }
    TEST_ASSERT_EQUAL(0, presses + longs);
    for (int k = 0; k < 100; k++, t++) {  // a 100 ms press
        SwitchEvent e = s.feed(false, t);
        presses += e == SwitchEvent::Press;
        longs += e == SwitchEvent::LongPress;
    }
    for (int k = 0; k < 100; k++, t++) {
        SwitchEvent e = s.feed(true, t);
        presses += e == SwitchEvent::Press;
        longs += e == SwitchEvent::LongPress;
    }
    TEST_ASSERT_EQUAL_MESSAGE(1, presses, "the next real press was swallowed");
    // a long press after such a glitch still gives a long press
    DebouncedSwitch u;
    for (uint32_t k = 0; k < 5; k++) u.feed(false, k);
    for (uint32_t k = 5; k < 100; k++) u.feed(true, k);
    int l = 0;
    for (uint32_t k = 100; k < 1200; k++) l += u.feed(false, k) == SwitchEvent::LongPress;
    TEST_ASSERT_EQUAL(1, l);
}

void test_with_no_reader_the_oldest_events_are_dropped_and_a_late_reader_can_start_from_now() {
    EncoderEvents q;
    for (int i = 0; i < 40; i++) {
        q.push(EncoderEvent{EncoderEvent::Turn, (int8_t)(i % 2 ? 1 : -1)});
    }
    q.push(EncoderEvent{EncoderEvent::LongPress, 0});  // the newest
    TEST_ASSERT_EQUAL((int)EncoderEvents::kCapacity, (int)q.size());
    TEST_ASSERT_EQUAL(41 - (int)EncoderEvents::kCapacity, (int)q.dropped());
    EncoderEvent e{};
    int n = 0;
    EncoderEvent last{};
    while (q.pop(e)) {
        last = e;
        n++;
    }
    TEST_ASSERT_EQUAL((int)EncoderEvents::kCapacity, n);
    TEST_ASSERT_TRUE(last.kind == EncoderEvent::LongPress);  // the newest is kept, the first events after boot are not
    // a reader that attaches late starts from now
    for (int i = 0; i < 10; i++) q.push(EncoderEvent{EncoderEvent::Press, 0});
    q.clear();
    TEST_ASSERT_FALSE(q.pop(e));
    q.push(EncoderEvent{EncoderEvent::Turn, 1});
    TEST_ASSERT_TRUE(q.pop(e));
    TEST_ASSERT_EQUAL(1, e.delta);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_every_full_cycle_counts_one_detent_in_its_direction);
    RUN_TEST(test_the_count_comes_at_the_detent_not_before);
    RUN_TEST(test_bounce_and_a_half_turn_that_comes_back_count_nothing);
    RUN_TEST(test_a_bounce_in_the_middle_of_a_real_turn_does_not_add_or_lose_a_count);
    RUN_TEST(test_an_illegal_transition_counts_nothing_until_the_encoder_is_next_at_rest);
    RUN_TEST(test_a_start_away_from_rest_counts_nothing_until_rest_has_been_seen_once);
    RUN_TEST(test_every_short_sample_sequence_agrees_with_the_oracle);
    RUN_TEST(test_a_switch_down_at_power_up_gives_no_press_and_no_long_press_until_it_has_been_released);
    RUN_TEST(test_a_glitch_at_start_up_does_not_swallow_the_next_real_press);
    RUN_TEST(test_with_no_reader_the_oldest_events_are_dropped_and_a_late_reader_can_start_from_now);
    RUN_TEST(test_a_short_press_gives_one_press_on_release_and_a_long_press_gives_one_long_press);
    RUN_TEST(test_contact_bounce_shorter_than_the_debounce_time_is_ignored);
    RUN_TEST(test_a_press_just_under_and_just_over_the_long_press_time);
    return UNITY_END();
}
