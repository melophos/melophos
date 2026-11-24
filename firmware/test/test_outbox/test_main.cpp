#include <string.h>
#include <unity.h>

#include <random>
#include <string>

#include "../support/fakes.h"
#include "outbox.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static QueueEntry session(const char *ref, int64_t startWall = 1767225600) {
    QueueEntry e{};
    e.kind = Kind::Session;
    strcpy(e.ref, ref);
    strcpy(e.profile, "piano-88");
    strcpy(e.mode, "melody");
    e.startWall = startWall;
    e.startMono = 1000;
    return e;
}

static std::vector<StoredEvent> events(int n, uint32_t base = 1000) {
    std::vector<StoredEvent> v;
    for (int i = 0; i < n; i++) {
        v.push_back(StoredEvent{base + (uint32_t)i * 10, (uint8_t)(30 + i % 60), 80, 0, 0});
    }
    return v;
}

static Outbox::Saved &saved() {
    static Outbox::Saved s;
    return s;
}

void test_a_session_survives_a_restart_until_it_is_delivered() {
    FakeFlash flash(4);
    {
        Outbox box(flash, 0);
        auto ev = events(40);
        box.sessionEnded(session("b3-s1"), ev.data(), ev.size());
    }
    Outbox after(flash, 0);  // power came back
    TEST_ASSERT_TRUE(after.load(saved()));
    TEST_ASSERT_EQUAL_STRING("b3-s1", saved().ref);
    TEST_ASSERT_EQUAL_STRING("piano-88", saved().profile);
    TEST_ASSERT_EQUAL_STRING("melody", saved().mode);
    TEST_ASSERT_EQUAL(40, saved().count);
    TEST_ASSERT_EQUAL(0, (int)saved().events[0].timeMs);   // saved relative to the session start
    TEST_ASSERT_EQUAL(390, (int)saved().events[39].timeMs);
    TEST_ASSERT_EQUAL(1767225600LL, saved().startWall);
    long erases = flash.erases();
    TEST_ASSERT_TRUE(after.markDelivered());
    TEST_ASSERT_EQUAL(erases, flash.erases());              // clearing the flag costs no erase
    Outbox third(flash, 0);
    TEST_ASSERT_FALSE(third.load(saved()));                 // delivered: nothing to send again
}

void test_only_the_last_session_is_kept_and_a_new_one_goes_to_the_other_slot() {
    FakeFlash flash(4);
    Outbox box(flash, 0);
    auto a = events(5), b = events(7);
    box.sessionEnded(session("b1-s1"), a.data(), a.size());
    box.sessionEnded(session("b1-s2"), b.data(), b.size());
    Outbox after(flash, 0);
    TEST_ASSERT_TRUE(after.load(saved()));
    TEST_ASSERT_EQUAL_STRING("b1-s2", saved().ref);
    TEST_ASSERT_EQUAL(7, saved().count);
}

void test_the_thousand_event_cap_keeps_the_newest_and_counts_the_rest() {
    FakeFlash flash(4);
    Outbox box(flash, 0);
    auto ev = events(1500);
    box.sessionEnded(session("b1-s1"), ev.data(), ev.size());
    Outbox after(flash, 0);
    TEST_ASSERT_TRUE(after.load(saved()));
    TEST_ASSERT_EQUAL(1000, saved().count);
    TEST_ASSERT_EQUAL(500, saved().lost);
    TEST_ASSERT_EQUAL(5000, (int)saved().events[0].timeMs);  // event 500 of 1500 is the first kept
    TEST_ASSERT_EQUAL(14990, (int)saved().events[999].timeMs);  // the very last event, 1499 x 10 ms in
}

void test_an_undated_session_is_not_saved() {
    FakeFlash flash(4);
    Outbox box(flash, 0);
    auto ev = events(3);
    box.sessionEnded(session("b1-s1", 0), ev.data(), ev.size());
    TEST_ASSERT_EQUAL(0, (int)box.writes());
    TEST_ASSERT_EQUAL(0, (int)flash.erases());
}

// a cut at every step of writing the second session leaves the first or the second, whole
void test_power_cut_at_every_step_keeps_a_whole_record() {
    long steps;
    {
        FakeFlash flash(4);
        Outbox box(flash, 0);
        auto a = events(60);
        box.sessionEnded(session("b1-s1"), a.data(), a.size());
        flash.resetCounters();
        auto b = events(80);
        box.sessionEnded(session("b1-s2"), b.data(), b.size());
        steps = flash.steps();
    }
    TEST_ASSERT_TRUE(steps > 600);
    for (long cut = 0; cut <= steps; cut += 1) {
        FakeFlash flash(4);
        Outbox box(flash, 0);
        auto a = events(60);
        box.sessionEnded(session("b1-s1"), a.data(), a.size());
        flash.cutAfter(cut);
        auto b = events(80);
        box.sessionEnded(session("b1-s2"), b.data(), b.size());
        flash.restorePower();
        Outbox after(flash, 0);
        TEST_ASSERT_TRUE_MESSAGE(after.load(saved()), "a session was lost to the cut");
        bool first = !strcmp(saved().ref, "b1-s1") && saved().count == 60;
        bool second = !strcmp(saved().ref, "b1-s2") && saved().count == 80;
        TEST_ASSERT_TRUE_MESSAGE(first || second, "a torn record was accepted");
    }
}

// the wear claim: one 2 sector erase per session that ends, spread over four sectors
void test_flash_writes_per_ordinary_day() {
    FakeFlash flash(4);
    Outbox box(flash, 0);
    auto ev = events(30);
    flash.resetCounters();
    for (int s = 0; s < 5; s++) {  // five sessions a day
        box.sessionEnded(session("b1-s1"), ev.data(), ev.size());
        box.markDelivered();
    }
    TEST_ASSERT_EQUAL(10, flash.erases());  // 5 sessions, 2 sectors each and delivery added none
    for (int day = 1; day < 100; day++) {
        for (int s = 0; s < 5; s++) {
            box.sessionEnded(session("b1-s1"), ev.data(), ev.size());
            box.markDelivered();
        }
    }
    uint32_t most = 0;
    for (uint32_t i = 0; i < 4; i++) {
        most = std::max(most, flash.wear(i));
    }
    TEST_ASSERT_EQUAL(250, (int)most);  // 100 days x 5 sessions x 2 sectors, over 4 sectors: 250 each
}

void test_saves_are_rate_limited_so_a_fast_sender_cannot_wear_the_flash_out() {
    FakeFlash flash(4);
    FakeClock clock;
    Outbox box(flash, 0, &clock);
    auto ev = events(5);
    flash.resetCounters();
    // a hostile sender: a session ending every 2 minutes (the idle gap) for a whole day
    for (int i = 0; i < 720; i++) {
        box.sessionEnded(session("b1-s1"), ev.data(), ev.size());
        box.markDelivered();
        clock.advance(120000);
    }
    TEST_ASSERT_EQUAL(144, (int)box.writes());         // one in ten minutes: 144 a day, not 720
    TEST_ASSERT_EQUAL(144 * 2, (int)flash.erases());   // 2 sectors a save
    TEST_ASSERT_EQUAL(576, (int)box.skipped());
    uint32_t most = 0;
    for (uint32_t i = 0; i < 4; i++) {
        most = std::max(most, flash.wear(i));
    }
    TEST_ASSERT_EQUAL(72, (int)most);  // 144 saves x 2 sectors over 4 sectors: every sector is erased 72 times in the day, 1388 days to 100 000
}

void test_hostile_flash_never_loads_a_bad_record() {
    std::mt19937 rng(std::random_device{}());
    for (int round = 0; round < 300; round++) {
        FakeFlash flash(4);
        Outbox box(flash, 0);
        auto ev = events(1 + (int)(rng() % 200));
        box.sessionEnded(session("b1-s1"), ev.data(), ev.size());
        // damage it: a few random byte changes in either slot
        for (int k = 0; k < 1 + (int)(rng() % 4); k++) {
            flash.raw()[rng() % (4 * 4096)] ^= (uint8_t)(1 + rng() % 255);
        }
        Outbox after(flash, 0);
        if (after.load(saved())) {
            TEST_ASSERT_TRUE(saved().count <= Outbox::kMaxEvents);
            TEST_ASSERT_TRUE(strlen(saved().ref) <= kRefMax);
        }
    }
}

// the whole path: saved, restored into the queue after a restart, delivered, marked
void test_restored_session_is_delivered_with_a_new_boot_and_the_saved_date() {
    FakeFlash flash(4);
    FakeClock clock;
    FakeWall wall;  // the clock is not set at boot: the saved date is what dates the session
    {
        OfflineQueue q;
        SessionPublisher pub(q, wall, 4);
        wall.epoch = 1767225600;
        Outbox box(flash, 0);
        pub.setEndListener(&box);
        for (int i = 0; i < 70; i++) {
            pub.onNote(NoteEvent{(uint32_t)(i * 50), (uint8_t)(40 + i % 30), 80, 0, NoteSource::UsbMidi});
        }
        pub.tick(70 * 50);
        pub.tick(70 * 50 + SessionPublisher::kIdleGapMs + 1);  // the session ends with everything unsent: offline
    }
    // power cut, then a new boot (5)
    OfflineQueue q;
    wall.epoch = 0;
    SessionPublisher pub(q, wall, 5);
    Outbox box(flash, 0);
    TEST_ASSERT_TRUE(box.load(saved()));
    pub.restore(saved().ref, saved().profile, saved().mode, saved().startWall, saved().events, saved().count, 0);
    TEST_ASSERT_TRUE(q.hasSession("b4-s1"));
    FakeMqtt mqtt;
    wall.epoch = 1767225600 + 10000;  // meanwhile the clock was set, but the old date must be kept
    MqttLink link(clock, mqtt, q, wall, "hub-abc", 5);
    for (int i = 0; i < 20; i++) {
        link.pump();
        clock.advance(10);
    }
    TEST_ASSERT_FALSE(q.hasSession("b4-s1"));
    TEST_ASSERT_TRUE(box.markDelivered());
    int events = 0;
    for (auto &m : mqtt.sent) {
        if (m.topic.find("/status") != std::string::npos) {
            continue;
        }
        TEST_ASSERT_NOT_NULL(strstr(m.payload.c_str(), "\"boot\":5"));
        TEST_ASSERT_NOT_NULL(strstr(m.payload.c_str(), "\"started_at\":\"2026-01-01T00:00:00Z\""));
        for (const char *p = m.payload.c_str(); (p = strstr(p, "\"t_ms\"")) != nullptr; p++) {
            events++;
        }
    }
    TEST_ASSERT_EQUAL(70, events);
    Outbox again(flash, 0);
    TEST_ASSERT_FALSE(again.load(saved()));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_a_session_survives_a_restart_until_it_is_delivered);
    RUN_TEST(test_only_the_last_session_is_kept_and_a_new_one_goes_to_the_other_slot);
    RUN_TEST(test_the_thousand_event_cap_keeps_the_newest_and_counts_the_rest);
    RUN_TEST(test_an_undated_session_is_not_saved);
    RUN_TEST(test_power_cut_at_every_step_keeps_a_whole_record);
    RUN_TEST(test_flash_writes_per_ordinary_day);
    RUN_TEST(test_saves_are_rate_limited_so_a_fast_sender_cannot_wear_the_flash_out);
    RUN_TEST(test_hostile_flash_never_loads_a_bad_record);
    RUN_TEST(test_restored_session_is_delivered_with_a_new_boot_and_the_saved_date);
    return UNITY_END();
}
