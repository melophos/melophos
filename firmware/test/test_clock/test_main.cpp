#include <unity.h>

#include "../support/fakes.h"
#include "clockguard.h"
#include "mqttlink.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static const int64_t kBuild = 1795000000;  // a build in November 2026

// a real SNTP reply carrying the true time. `t` is the hub's own elapsed milliseconds at the reply
static void reply(ClockGuard &g, FakeClock &c, uint32_t afterMs, int64_t value) {
    c.advance(afterMs);
    g.offer(value);
}

void test_the_build_time_parses_from_the_compilers_strings() {
    TEST_ASSERT_EQUAL(1795348800LL, buildEpochFrom("Nov 22 2026", "12:00:00"));  // 2026-11-22 12:00 UTC
    TEST_ASSERT_EQUAL(1767225600LL, buildEpochFrom("Jan  1 2026", "00:00:00"));
    TEST_ASSERT_EQUAL(1835481599LL, buildEpochFrom("Feb 29 2028", "23:59:59"));
    TEST_ASSERT_EQUAL(0, (int)buildEpochFrom("garbage", "12:00:00"));
    TEST_ASSERT_EQUAL(0, (int)buildEpochFrom(nullptr, nullptr));
}

void test_a_first_reply_near_the_build_is_taken_and_time_then_moves_with_the_hubs_own_clock() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    TEST_ASSERT_EQUAL(0, (int)g.epochSeconds());
    g.offer(kBuild + 3600);
    TEST_ASSERT_EQUAL(kBuild + 3600, g.epochSeconds());
    clock.advance(5000);
    TEST_ASSERT_EQUAL(kBuild + 3605, g.epochSeconds());
    reply(g, clock, 1000, kBuild + 3606 + 300);  // 5 minutes of drift, inside the slack
    TEST_ASSERT_EQUAL(kBuild + 3906, g.epochSeconds());
}

void test_a_reply_older_than_the_firmware_is_ignored() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild - 2 * 86400);
    g.offer(0);
    g.offer(-5);
    TEST_ASSERT_EQUAL(0, (int)g.epochSeconds());
}

// probe: one forged reply two years ahead and then nothing. Nothing may come to believe it, however long
void test_one_forged_reply_is_never_believed_and_the_backlog_is_kept() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 600);
    FakeMqtt mqtt;
    OfflineQueue queue;
    MqttLink link(clock, mqtt, queue, g, "hub-a1b2c3d4e5f6", 1);
    QueueEntry e{};
    e.kind = Kind::Session;
    strcpy(e.ref, "kept");
    strcpy(e.profile, "piano-88");
    e.startWall = kBuild + 100;
    mqtt.autoAck = false;
    queue.push(e, nullptr, 0, 0);
    g.offer(kBuild + 600 + 2 * 366 * 86400LL);
    TEST_ASSERT_TRUE(g.pending());
    for (int hour = 0; hour < 5; hour++) {
        clock.advance(3600000);
        TEST_ASSERT_TRUE(g.epochSeconds() < kBuild + 600 + 5 * 3600 + 10);
    }
    TEST_ASSERT_TRUE(g.pending());
    for (int i = 0; i < 6; i++) {
        link.pump();
    }
    TEST_ASSERT_TRUE(queue.hasSession("kept"));
}

// second probe: forged replies that each step 7 days further. None agrees with the one before
void test_a_staircase_of_forged_replies_never_moves_the_clock_far() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 3600);
    int64_t forged = kBuild + 3600;
    for (int i = 0; i < 60; i++) {
        forged += 7 * 86400;
        reply(g, clock, 40000, forged);
    }
    int64_t moved = g.epochSeconds() - (kBuild + 3600);
    TEST_ASSERT_TRUE_MESSAGE(moved < 3600, "the staircase moved the clock");  // only the hub's own 40 minutes
}

// steps that are each small but add up are held to the allowance for the hub's own elapsed time. (Replies that
// all lie by the SAME amount do agree: that is the stated residual in docs/mqtt.md)
void test_small_forward_steps_cannot_add_up_to_a_large_one() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 3600);
    int64_t ahead = 0;
    for (int i = 0; i < 20; i++) {  // 20 replies, 60 s apart, each 500 s ahead of what the hub believes
        int64_t believed = g.epochSeconds();
        clock.advance(60000);
        g.offer(believed + 60 + 500 + 100 * i);  // never the same offset twice, so they do not agree
        ahead = g.epochSeconds() - (kBuild + 3600) - 60 * (i + 1);
    }
    // 20 minutes elapsed: the allowance is 600 s of slack plus 600 s an hour, nothing like 20 x 500 s
    TEST_ASSERT_TRUE_MESSAGE(ahead <= 600 + 600 * 20 / 60 + 1, "small steps added up past the allowance");
}

void test_three_separate_agreeing_replies_accept_a_large_jump() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 600);
    int64_t far = kBuild + 600 + 400LL * 86400;
    g.offer(far);
    TEST_ASSERT_TRUE(g.pending());
    reply(g, clock, 10000, far + 10);  // too soon to be a separate opinion
    TEST_ASSERT_TRUE(g.pending());
    reply(g, clock, 30000, far + 40);  // 40 s after the first
    TEST_ASSERT_TRUE(g.pending());
    reply(g, clock, 30000, far + 70);
    TEST_ASSERT_FALSE(g.pending());
    TEST_ASSERT_EQUAL(far + 70, g.epochSeconds());
}

// kills a widened agreement tolerance: replies half an hour apart from what the hub's clock says are not agreement
void test_replies_that_disagree_by_minutes_do_not_agree() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 600);
    int64_t far = kBuild + 600 + 400LL * 86400;
    g.offer(far);
    reply(g, clock, 31000, far + 31 + 1800);  // half an hour out
    reply(g, clock, 31000, far + 62 + 3600);  // and an hour out
    reply(g, clock, 31000, far + 93 + 60);    // a minute out
    TEST_ASSERT_TRUE(g.pending());
    TEST_ASSERT_TRUE(g.epochSeconds() < kBuild + 2000);
    // exactly on the tolerance is agreement and one second beyond is not
    FakeClock c2;
    ClockGuard h(c2, kBuild);
    h.offer(kBuild + 600);
    h.offer(far);
    reply(h, c2, 31000, far + 31 + ClockGuard::kAgreeToleranceS + 1);
    reply(h, c2, 31000, far + 62 + ClockGuard::kAgreeToleranceS + 1);
    TEST_ASSERT_TRUE(h.pending());
}

void test_a_pending_reply_is_forgotten_after_ten_minutes() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 600);
    int64_t far = kBuild + 600 + 400LL * 86400;
    g.offer(far);
    reply(g, clock, ClockGuard::kPendingMs + 1000, far + 601);  // far too late to count as agreement
    TEST_ASSERT_TRUE(g.pending());                              // it only restarted the count
    TEST_ASSERT_TRUE(g.epochSeconds() < kBuild + 2000);
}

void test_a_first_reply_far_after_the_build_needs_partners_and_the_counter_wraps_safely() {
    FakeClock clock;
    clock.now = 0xFFFFFF00u;  // about to wrap
    ClockGuard g(clock, kBuild);
    int64_t far = kBuild + 300LL * 86400;  // a hub that sat on a shelf for ten months
    g.offer(far);
    TEST_ASSERT_TRUE(g.pending());
    TEST_ASSERT_EQUAL(0, (int)g.epochSeconds());
    reply(g, clock, 31000, far + 31);  // across the wrap
    reply(g, clock, 31000, far + 62);
    TEST_ASSERT_FALSE(g.pending());
    TEST_ASSERT_EQUAL(far + 62, g.epochSeconds());
}

// a session is never dropped because of the clock alone: a stale one is held until the time is believed again or
// a person clears it
void test_a_stale_session_is_held_not_dropped_and_a_person_can_clear_it() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 600);
    FakeMqtt mqtt;
    OfflineQueue queue;
    MqttLink link(clock, mqtt, queue, g, "hub-a1b2c3d4e5f6", 1);
    QueueEntry e{};
    e.kind = Kind::Session;
    strcpy(e.ref, "old");
    strcpy(e.profile, "piano-88");
    e.startWall = kBuild + 600 - 400LL * 86400;  // 400 days before the believed time
    queue.push(e, nullptr, 0, 0);
    for (int i = 0; i < 10; i++) {
        link.pump();
        clock.advance(20);
    }
    TEST_ASSERT_TRUE(queue.hasSession("old"));
    TEST_ASSERT_TRUE(link.holdingStale());
    for (auto &m : mqtt.sent) {
        TEST_ASSERT_TRUE(m.payload.find("\"session_ref\":\"old\"") == std::string::npos);
    }
    TEST_ASSERT_EQUAL(1, (int)link.clearStale());  // the person asks for it
    TEST_ASSERT_FALSE(queue.hasSession("old"));
}

// ---------- the server is the authority on time ----------

static void sayNothing(const char *) {}
static int said = 0;
static void sayCount(const char *) { said++; }

// three agreeing forged replies 30 s apart: what an attacker who controls the network can always do
static void forge(ClockGuard &g, FakeClock &c, int64_t forgedNow) {
    g.offer(forgedNow);
    reply(g, c, 31000, forgedNow + 31);
    reply(g, c, 31000, forgedNow + 62);
}

// probe 1: one forged reply two years ahead is believed after about a minute. The first server answer ends it
void test_forged_sntp_then_one_server_answer_ends_within_tolerance_of_the_true_time() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    const int64_t t0 = kBuild + 3600;
    g.offer(t0);                                      // the first reply is true
    clock.advance(1000);
    forge(g, clock, t0 + 1 + 2 * 366 * 86400LL);      // then forged ones, believed
    TEST_ASSERT_TRUE(g.epochSeconds() > t0 + 400LL * 86400);
    int64_t trueNow = t0 + (int64_t)(clock.now / 1000);
    sync.onServerTime(trueNow, true);
    int64_t err = g.epochSeconds() - trueNow;
    TEST_ASSERT_TRUE_MESSAGE(err <= ClockGuard::kServerToleranceS && err >= -ClockGuard::kServerToleranceS, "not within tolerance of the true time");
    TEST_ASSERT_TRUE(g.sntpDistrusted());
    // more forged replies are now ignored, as is any agreeing run
    forge(g, clock, g.epochSeconds() + 3LL * 366 * 86400);
    int64_t trueLater = t0 + (int64_t)(clock.now / 1000);
    int64_t err2 = g.epochSeconds() - trueLater;
    TEST_ASSERT_TRUE(err2 <= ClockGuard::kServerToleranceS && err2 >= -ClockGuard::kServerToleranceS);
    // a true SNTP reply clears the distrust
    reply(g, clock, 31000, t0 + (int64_t)(clock.now / 1000));
    TEST_ASSERT_FALSE(g.sntpDistrusted());
}

// probe 2: 60 forged replies 7 days apart
void test_sixty_forged_replies_seven_days_apart_are_undone_by_one_server_answer() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    const int64_t t0 = kBuild + 3600;
    g.offer(t0);
    for (int i = 0; i < 60; i++) {
        reply(g, clock, 10000, g.epochSeconds() + 7 * 86400 - 60);
    }
    int64_t trueNow = t0 + (int64_t)(clock.now / 1000);
    sync.onServerTime(trueNow, true);
    int64_t err = g.epochSeconds() - trueNow;
    TEST_ASSERT_TRUE(err <= ClockGuard::kServerToleranceS && err >= -ClockGuard::kServerToleranceS);
}

void test_sntp_and_the_server_agreeing_changes_nothing_and_distrusts_nothing() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    g.offer(kBuild + 3600);
    clock.advance(60000);
    sync.onServerTime(kBuild + 3600 + 60 + 90, true);  // 90 s apart: inside the tolerance
    TEST_ASSERT_FALSE(g.sntpDistrusted());
    int64_t d;
    uint32_t since;
    TEST_ASSERT_FALSE(g.takeCorrection(d, since));
    TEST_ASSERT_TRUE(g.serverHeard());
}

void test_with_no_time_yet_the_servers_time_sets_it_and_a_server_without_the_field_changes_nothing() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    TEST_ASSERT_EQUAL(0, (int)g.epochSeconds());
    // an older server sends no server_time: the sink is never called and SNTP rules stand alone
    g.offer(kBuild + 600);
    TEST_ASSERT_FALSE(g.serverHeard());
    TEST_ASSERT_EQUAL(kBuild + 600, g.epochSeconds());
    FakeClock c2;
    ClockGuard h(c2, kBuild);
    OfflineQueue queue;
    ClockSync sync(h, queue, nullptr, sayNothing);
    sync.onServerTime(kBuild + 5 * 86400LL, true);
    TEST_ASSERT_EQUAL(kBuild + 5 * 86400LL, h.epochSeconds());
    TEST_ASSERT_FALSE(h.sntpDistrusted());  // nothing to correct: it had no time
}

// once the server has been heard a run of agreeing SNTP replies no longer moves the clock far
void test_after_the_server_is_heard_agreeing_forged_replies_cannot_move_the_clock() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    g.offer(kBuild + 3600);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    sync.onServerTime(kBuild + 3600, true);
    forge(g, clock, kBuild + 3600 + 62 + 400LL * 86400);
    int64_t trueNow = kBuild + 3600 + (int64_t)(clock.now / 1000);
    int64_t err = g.epochSeconds() - trueNow;
    TEST_ASSERT_TRUE(err <= ClockGuard::kServerToleranceS && err >= -ClockGuard::kServerToleranceS);
}

// dates taken from the wrong clock move with it. Sent ones and earlier ones do not
void test_sessions_dated_by_a_wrong_clock_are_redated_when_the_server_corrects_it() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    const int64_t t0 = kBuild + 3600;
    QueueEntry early{};  // queued before any time was taken from SNTP
    early.kind = Kind::Session;
    strcpy(early.ref, "early");
    early.startWall = t0;
    queue.push(early, nullptr, 0, clock.now);
    clock.advance(1000);
    g.offer(t0);
    clock.advance(5000);
    forge(g, clock, g.epochSeconds() + 2 * 366 * 86400LL);   // the clock goes wrong
    QueueEntry bad{};
    bad.kind = Kind::Session;
    strcpy(bad.ref, "bad");
    bad.startWall = g.epochSeconds();                          // dated by the wrong clock
    queue.push(bad, nullptr, 0, clock.now);
    QueueEntry sent{};
    sent.kind = Kind::Session;
    strcpy(sent.ref, "sent");
    sent.startWall = g.epochSeconds();
    sent.seq = 4;
    queue.push(sent, nullptr, 0, clock.now);
    int64_t before = g.epochSeconds();
    int64_t trueNow = t0 + (int64_t)(clock.now / 1000);
    sync.onServerTime(trueNow, true);
    int64_t delta = g.epochSeconds() - before;
    TEST_ASSERT_TRUE(delta < -400LL * 86400);
    int64_t got[3] = {0, 0, 0};
    for (int i = 0; i < 3; i++) {
        QueueEntry e;
        TEST_ASSERT_TRUE(queue.front(e));
        got[i] = e.startWall;
        if (i == 0) TEST_ASSERT_EQUAL_STRING("early", e.ref);
        queue.popFront();
    }
    TEST_ASSERT_EQUAL(t0, got[0]);                                   // earlier than the first wrong time: untouched
    int64_t err = got[1] - trueNow;
    TEST_ASSERT_TRUE(err <= 10 && err >= -10);                        // re-dated to the server's time
    TEST_ASSERT_EQUAL(before, got[2]);                               // already sent: left as it was
}

// a recording session in progress is re-dated by the main task from the hand-over
void test_the_recording_session_is_redated_through_the_hand_over() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    const int64_t t0 = kBuild + 3600;
    g.offer(t0);
    forge(g, clock, t0 + 62 + 2 * 366 * 86400LL);
    sync.onServerTime(t0 + (int64_t)(clock.now / 1000), true);
    int64_t delta = 0;
    uint32_t since = 0;
    TEST_ASSERT_TRUE(sync.takeSessionRedate(delta, since));
    TEST_ASSERT_TRUE(delta < -400LL * 86400);
    TEST_ASSERT_FALSE(sync.takeSessionRedate(delta, since));
}

// a server whose own clock is not set yet (a Pi with no clock battery after a power cut)
void test_a_server_that_says_its_clock_is_not_set_corrects_nothing_holds_sessions_and_says_so_once() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    FakeMqtt mqtt;
    OfflineQueue queue;
    MqttLink link(clock, mqtt, queue, g, "hub-a1b2c3d4e5f6", 1);
    said = 0;
    ClockSync sync(g, queue, nullptr, sayCount);
    const int64_t t0 = kBuild + 3600;
    g.offer(t0);
    QueueEntry dated{};
    dated.kind = Kind::Session;
    strcpy(dated.ref, "dated");
    strcpy(dated.profile, "piano-88");
    dated.startWall = t0;
    queue.push(dated, nullptr, 0, clock.now);
    QueueEntry undated{};
    undated.kind = Kind::Session;
    strcpy(undated.ref, "undated");
    strcpy(undated.profile, "piano-88");
    undated.startWall = 0;
    undated.startMono = clock.now;
    queue.push(undated, nullptr, 0, clock.now);
    // the server's clock is far behind and says it is not set: the hub's clock is NOT corrected from it
    int64_t before = g.epochSeconds();
    sync.onServerTime(kBuild - 200LL * 86400, false);
    sync.onServerTime(kBuild - 200LL * 86400 + 900, false);  // asked again at the normal interval
    TEST_ASSERT_EQUAL(before, g.epochSeconds());
    TEST_ASSERT_TRUE(g.holding());
    TEST_ASSERT_EQUAL(0, (int)g.datingSeconds());
    TEST_ASSERT_EQUAL(1, said);  // reported once, not every time
    for (int i = 0; i < 20; i++) {
        link.pump();
        clock.advance(20);
    }
    for (auto &m : mqtt.sent) {
        TEST_ASSERT_TRUE(m.topic.find("/session") == std::string::npos);  // nothing is sent, dated or not
    }
    TEST_ASSERT_TRUE(queue.hasSession("dated") && queue.hasSession("undated"));
    // the server goes from false to true: the held sessions are dated and sent
    sync.onServerTime(t0 + (int64_t)(clock.now / 1000), true);
    TEST_ASSERT_FALSE(g.holding());
    TEST_ASSERT_TRUE(g.datingSeconds() != 0);
    for (int i = 0; i < 40; i++) {
        link.pump();
        clock.advance(20);
    }
    int sessions = 0;
    for (auto &m : mqtt.sent) {
        sessions += m.topic.find("/session") != std::string::npos;
    }
    TEST_ASSERT_EQUAL(2, sessions);
    TEST_ASSERT_FALSE(queue.hasSession("undated"));
    // and the next unsynced spell is reported again
    sync.onServerTime(kBuild, false);
    TEST_ASSERT_EQUAL(2, said);
}

void test_a_synced_true_answer_corrects_the_clock_as_before() {
    FakeClock clock;
    ClockGuard g(clock, kBuild);
    OfflineQueue queue;
    ClockSync sync(g, queue, nullptr, sayNothing);
    g.offer(kBuild + 3600);
    sync.onServerTime(kBuild + 3600 + 5000, true);
    TEST_ASSERT_EQUAL(kBuild + 3600 + 5000, g.epochSeconds());
    TEST_ASSERT_FALSE(g.holding());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_the_build_time_parses_from_the_compilers_strings);
    RUN_TEST(test_a_first_reply_near_the_build_is_taken_and_time_then_moves_with_the_hubs_own_clock);
    RUN_TEST(test_a_reply_older_than_the_firmware_is_ignored);
    RUN_TEST(test_one_forged_reply_is_never_believed_and_the_backlog_is_kept);
    RUN_TEST(test_a_staircase_of_forged_replies_never_moves_the_clock_far);
    RUN_TEST(test_small_forward_steps_cannot_add_up_to_a_large_one);
    RUN_TEST(test_three_separate_agreeing_replies_accept_a_large_jump);
    RUN_TEST(test_replies_that_disagree_by_minutes_do_not_agree);
    RUN_TEST(test_a_pending_reply_is_forgotten_after_ten_minutes);
    RUN_TEST(test_a_first_reply_far_after_the_build_needs_partners_and_the_counter_wraps_safely);
    RUN_TEST(test_a_stale_session_is_held_not_dropped_and_a_person_can_clear_it);
    RUN_TEST(test_forged_sntp_then_one_server_answer_ends_within_tolerance_of_the_true_time);
    RUN_TEST(test_sixty_forged_replies_seven_days_apart_are_undone_by_one_server_answer);
    RUN_TEST(test_sntp_and_the_server_agreeing_changes_nothing_and_distrusts_nothing);
    RUN_TEST(test_with_no_time_yet_the_servers_time_sets_it_and_a_server_without_the_field_changes_nothing);
    RUN_TEST(test_after_the_server_is_heard_agreeing_forged_replies_cannot_move_the_clock);
    RUN_TEST(test_sessions_dated_by_a_wrong_clock_are_redated_when_the_server_corrects_it);
    RUN_TEST(test_the_recording_session_is_redated_through_the_hand_over);
    RUN_TEST(test_a_server_that_says_its_clock_is_not_set_corrects_nothing_holds_sessions_and_says_so_once);
    RUN_TEST(test_a_synced_true_answer_corrects_the_clock_as_before);
    return UNITY_END();
}
