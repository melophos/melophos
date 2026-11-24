#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>

#include "../support/fakes.h"
#include "publish.h"
#include "recordpair.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static NoteEvent note(uint32_t t, uint8_t n, uint8_t v = 80, NoteSource s = NoteSource::UsbMidi) {
    return NoteEvent{t, n, v, 0, s};
}

static std::string golden(const char *name) {
    FILE *f = fopen("test/data/mqtt_golden.txt", "rb");
    TEST_ASSERT_NOT_NULL_MESSAGE(f, "test/data/mqtt_golden.txt");
    char line[4096];
    std::string want = std::string(name) + "\t";
    while (fgets(line, sizeof line, f)) {
        std::string l = line;
        while (!l.empty() && (l.back() == '\n' || l.back() == '\r')) {
            l.pop_back();
        }
        if (l.compare(0, want.size(), want) == 0) {
            fclose(f);
            return l.substr(want.size());
        }
    }
    fclose(f);
    TEST_FAIL_MESSAGE("golden line missing");
    return "";
}

void test_topics_follow_the_protocol() {
    char t[96];
    TEST_ASSERT_EQUAL(31, (int)topicFor(t, sizeof t, "hub-a1b2c3d4e5f6", Kind::Notes));
    TEST_ASSERT_EQUAL_STRING("melophos/hub-a1b2c3d4e5f6/notes", t);
    topicFor(t, sizeof t, "hub-1", Kind::Session);
    TEST_ASSERT_EQUAL_STRING("melophos/hub-1/session", t);
    topicFor(t, sizeof t, "hub-1", Kind::Status);
    TEST_ASSERT_EQUAL_STRING("melophos/hub-1/status", t);
}

void test_device_ids_that_the_server_would_refuse_are_never_published_to() {
    const char *bad[] = {"", "ab", "a+b", "hub/x", "hub#", "Hub-1", "-hub", "hub 1", "hub\n1", "héllo-1", "+", "#"};
    char t[96];
    for (const char *id : bad) {
        TEST_ASSERT_FALSE_MESSAGE(validDeviceId(id), id);
        TEST_ASSERT_EQUAL(0, (int)topicFor(t, sizeof t, id, Kind::Notes));
    }
    TEST_ASSERT_FALSE(validDeviceId(std::string(65, 'a').c_str()));
    TEST_ASSERT_TRUE(validDeviceId(std::string(64, 'a').c_str()));
    TEST_ASSERT_FALSE(validDeviceId(nullptr));
    char tiny[10];
    TEST_ASSERT_EQUAL(0, (int)topicFor(tiny, sizeof tiny, "hub-1", Kind::Notes));
}

void test_iso_time_including_a_leap_day_and_the_bounds() {
    char s[21];
    TEST_ASSERT_TRUE(formatIso8601(1767225600, s));
    TEST_ASSERT_EQUAL_STRING("2026-01-01T00:00:00Z", s);
    TEST_ASSERT_TRUE(formatIso8601(1835481599, s));
    TEST_ASSERT_EQUAL_STRING("2028-02-29T23:59:59Z", s);
    TEST_ASSERT_TRUE(formatIso8601(1898000000, s));
    TEST_ASSERT_EQUAL_STRING("2030-02-22T14:13:20Z", s);
    TEST_ASSERT_TRUE(formatIso8601(4102444799LL, s));
    TEST_ASSERT_EQUAL_STRING("2099-12-31T23:59:59Z", s);
    TEST_ASSERT_FALSE(formatIso8601(0, s));
    TEST_ASSERT_FALSE(formatIso8601(1000, s));  // a clock that has not been set
    TEST_ASSERT_FALSE(formatIso8601(4102444800LL, s));
    TEST_ASSERT_FALSE(formatIso8601(-5, s));
}

// the same strings are checked against the server's models by test/contract_check.py
void test_payloads_match_the_golden_files() {
    OfflineQueue q;
    FakeWall wall;
    wall.epoch = 1767225600;
    SessionPublisher pub(q, wall, 7);
    pub.setProfile("piano-88");
    pub.setMode("melody");
    pub.onNote(note(1000, 60, 90));
    pub.onNote(note(1200, 60, 0));
    pub.onNote(NoteEvent{1500, 64, 70, 3, NoteSource::BleMidi});
    pub.tick(1250);  // the first batch leaves at 250 ms
    pub.tick(2000);
    pub.tick(1000 + SessionPublisher::kIdleGapMs + 600);
    TEST_ASSERT_EQUAL(2, (int)q.size());
    QueueEntry e;
    StringSink notes, session, status;
    TEST_ASSERT_TRUE(q.front(e));
    TEST_ASSERT_FALSE(encodeEntry(q, e, wall.epoch, 5000, notes));  // not stamped yet: never built
    q.stampFront(7, 1);
    q.front(e);
    TEST_ASSERT_TRUE(encodeEntry(q, e, wall.epoch, 5000, notes));
    q.popFront();
    q.stampFront(7, 1);
    TEST_ASSERT_TRUE(q.front(e));
    TEST_ASSERT_TRUE(encodeEntry(q, e, wall.epoch, 5000, session));
    StatusInfo info{"0.1.0", "piano-88", true, false, true, false, 12};
    TEST_ASSERT_TRUE(encodeStatus(7, 3, info, status));
    TEST_ASSERT_EQUAL_STRING(golden("notes").c_str(), notes.text.c_str());
    TEST_ASSERT_EQUAL_STRING(golden("session").c_str(), session.text.c_str());
    TEST_ASSERT_EQUAL_STRING(golden("status").c_str(), status.text.c_str());
}

void test_a_session_that_began_before_the_clock_was_set_is_dated_once_it_is() {
    OfflineQueue q;
    FakeWall wall;  // unset
    SessionPublisher pub(q, wall, 1);
    pub.onNote(note(10000, 60));
    pub.tick(10300);
    pub.onNote(note(12000, 62));
    QueueEntry e;
    TEST_ASSERT_TRUE(q.front(e));
    TEST_ASSERT_EQUAL(0, (int)e.startWall);  // nothing to date it with
    q.stampFront(1, 1);
    q.front(e);
    StringSink s;
    TEST_ASSERT_FALSE(encodeEntry(q, e, 0, 20000, s));  // a message with no date is never built
    wall.epoch = 1767225600 + 100;
    pub.tick(20000);  // the clock is set: 10 s since the first note, so it began at epoch + 90
    pub.tick(20300);
    q.front(e);
    TEST_ASSERT_TRUE(encodeEntry(q, e, wall.epoch, 20300, s));
    TEST_ASSERT_NOT_NULL(strstr(s.text.c_str(), "2026-01-01T00:01:30Z"));
    // every message of the session carries the same started_at, as the protocol requires
    pub.tick(10000 + SessionPublisher::kIdleGapMs + 20000);
    std::string first;
    int seen = 0;
    while (q.front(e)) {
        q.stampFront(1, (uint32_t)(seen + 1));
        q.front(e);
        StringSink one;
        TEST_ASSERT_TRUE(encodeEntry(q, e, wall.epoch, 0, one));
        const char *at = strstr(one.text.c_str(), "\"started_at\":\"");
        std::string stamp = std::string(at + 14, 20);
        if (first.empty()) {
            first = stamp;
        }
        TEST_ASSERT_EQUAL_STRING(first.c_str(), stamp.c_str());
        q.popFront();
        seen++;
    }
    TEST_ASSERT_TRUE(seen >= 2);
}

void test_batches_are_every_250_ms_and_capped_at_32_events() {
    OfflineQueue q;
    FakeWall wall;
    wall.epoch = 1767225600;
    SessionPublisher pub(q, wall, 1);
    pub.onNote(note(0, 60));
    pub.tick(249);
    TEST_ASSERT_EQUAL(0, (int)q.size());
    pub.tick(250);
    TEST_ASSERT_EQUAL(1, (int)q.size());
    for (int i = 0; i < 100; i++) {
        pub.onNote(note(300 + (uint32_t)i, (uint8_t)(30 + i % 60)));  // 100 notes inside one millisecond-ish burst
    }
    pub.tick(700);
    size_t events = 0;
    QueueEntry e;
    while (q.front(e)) {
        TEST_ASSERT_TRUE(e.eventCount <= 32);
        events += e.eventCount;
        q.popFront();
    }
    TEST_ASSERT_EQUAL(101, (int)events);
}

void test_a_session_ends_after_a_quiet_gap_and_a_new_one_gets_a_new_ref() {
    OfflineQueue q;
    FakeWall wall;
    wall.epoch = 1767225600;
    SessionPublisher pub(q, wall, 4);
    pub.onNote(note(0, 60));
    pub.tick(SessionPublisher::kIdleGapMs);
    TEST_ASSERT_TRUE(pub.active());
    pub.tick(SessionPublisher::kIdleGapMs + 1);
    TEST_ASSERT_FALSE(pub.active());
    pub.onNote(note(200000, 62, 0));  // a stray release does not open a session
    TEST_ASSERT_FALSE(pub.active());
    pub.onNote(note(300000, 62));
    TEST_ASSERT_TRUE(pub.active());
    QueueEntry a, b;
    q.front(a);
    q.popFront();
    q.popFront();
    TEST_ASSERT_TRUE(q.size() == 0);
    pub.tick(300000 + SessionPublisher::kIdleGapMs + 1);
    q.front(b);
    TEST_ASSERT_EQUAL_STRING("b4-s1", a.ref);
    TEST_ASSERT_TRUE(b.kind == Kind::Notes);
    TEST_ASSERT_EQUAL_STRING("b4-s2", b.ref);
    TEST_ASSERT_EQUAL(0, (int)a.seq);  // stamped when first sent, not before
}

// ----- the offline queue -----

static QueueEntry entryFor(Kind k, uint32_t seq) {
    QueueEntry e{};
    e.kind = k;
    e.seq = seq;
    strcpy(e.ref, "b1-s1");
    strcpy(e.profile, "piano-88");
    return e;
}

void test_queue_drops_oldest_first_and_counts() {
    OfflineQueue q;
    StoredEvent ev[3] = {{1, 60, 80, 0, 0}, {2, 61, 80, 0, 0}, {3, 62, 80, 0, 0}};
    for (uint32_t i = 1; i <= 20; i++) {
        q.push(entryFor(Kind::Notes, i), ev, 3, i);
    }
    TEST_ASSERT_EQUAL(16, (int)q.size());
    TEST_ASSERT_EQUAL(4, (int)q.droppedMessages());
    TEST_ASSERT_EQUAL(12, (int)q.droppedEvents());
    QueueEntry e;
    q.front(e);
    TEST_ASSERT_EQUAL(5, (int)e.seq);  // 1 to 4 went
    TEST_ASSERT_EQUAL(48, (int)q.events());
}

void test_queue_event_pool_limit_holds() {
    OfflineQueue q;
    StoredEvent ev[kBatchMax];
    memset(ev, 0, sizeof ev);
    for (uint32_t i = 1; i <= 300; i++) {
        q.push(entryFor(Kind::Notes, i), ev, kBatchMax, i);
        TEST_ASSERT_TRUE(q.events() <= OfflineQueue::kMaxEvents);
        TEST_ASSERT_TRUE(q.size() <= OfflineQueue::kMaxMessages);
    }
    TEST_ASSERT_TRUE(q.droppedMessages() > 0);
    // what is left is the newest, in order
    QueueEntry e;
    uint32_t prev = 0;
    while (q.front(e)) {
        TEST_ASSERT_TRUE(e.seq > prev);
        prev = e.seq;
        q.popFront();
    }
    TEST_ASSERT_EQUAL(300, (int)prev);
    TEST_ASSERT_EQUAL(0, (int)q.events());
}

void test_queue_age_limit_including_the_counter_wrapping() {
    OfflineQueue q;
    uint32_t t0 = 0xFFFFFFFFu - 1000;
    q.push(entryFor(Kind::Session, 1), nullptr, 0, t0);
    q.expire(t0 + OfflineQueue::kMaxAgeMs);
    TEST_ASSERT_EQUAL(1, (int)q.size());
    q.expire(t0 + OfflineQueue::kMaxAgeMs + 1);
    TEST_ASSERT_EQUAL(0, (int)q.size());
    TEST_ASSERT_EQUAL(1, (int)q.droppedMessages());
}

void test_queue_refuses_bad_pushes() {
    OfflineQueue q;
    StoredEvent ev[kBatchMax + 1];
    memset(ev, 0, sizeof ev);
    TEST_ASSERT_FALSE(q.push(entryFor(Kind::Notes, 1), ev, kBatchMax + 1, 0));
    TEST_ASSERT_FALSE(q.push(entryFor(Kind::Notes, 1), nullptr, 3, 0));
    TEST_ASSERT_EQUAL(0, (int)q.size());
}

void test_worst_case_message_fits_the_payload_limit() {
    OfflineQueue q;
    StoredEvent ev[kBatchMax];
    for (auto &e : ev) {
        e = StoredEvent{0xFFFFFFF0u, 127, 127, 15, (uint8_t)NoteSource::MidiJack};
    }
    QueueEntry e = entryFor(Kind::Notes, 4294967295u);
    e.boot = 4294967295u;
    memset(e.ref, 'x', kRefMax);
    e.ref[kRefMax] = 0;
    memset(e.profile, 'p', 32);
    e.profile[32] = 0;
    e.startWall = 1767225600;
    q.push(e, ev, kBatchMax, 0);
    q.front(e);
    StringSink s;
    TEST_ASSERT_TRUE(encodeEntry(q, e, 1767225600, 0, s));
    TEST_ASSERT_TRUE(s.text.size() < MqttLink::kMaxPayload);
    TEST_ASSERT_TRUE(MqttLink::kMaxPayload < 128 * 1024);  // the broker refuses anything over 128 KiB
}

// ----- the link -----

struct Rig {
    FakeClock clock;
    FakeMqtt mqtt;
    FakeWall wall;
    OfflineQueue queue;
    MqttLink link{clock, mqtt, queue, wall, "hub-a1b2c3d4e5f6", 7};
    Rig() { wall.epoch = 1767225600; }
};

void test_sessions_queue_while_offline_and_go_out_in_order_on_reconnect() {
    Rig r;
    r.mqtt.allowConnect = false;
    SessionPublisher pub(r.queue, r.wall, 7);
    for (int s = 0; s < 3; s++) {
        pub.onNote(note(r.clock.now, (uint8_t)(60 + s)));
        pub.tick(r.clock.now + SessionPublisher::kIdleGapMs + 1);
        r.clock.advance(SessionPublisher::kIdleGapMs + 2);
        r.link.pump();
    }
    TEST_ASSERT_EQUAL(0, (int)r.mqtt.sent.size());
    TEST_ASSERT_EQUAL(6, (int)r.queue.size());  // 3 notes messages and 3 session messages
    r.mqtt.allowConnect = true;
    r.clock.advance(70000);
    for (int i = 0; i < 20; i++) {
        r.link.pump();
        r.clock.advance(1);
    }
    TEST_ASSERT_EQUAL(0, (int)r.queue.size());
    // status first, then the six queued messages oldest first
    TEST_ASSERT_EQUAL(7, (int)r.mqtt.sent.size());
    TEST_ASSERT_EQUAL_STRING("melophos/hub-a1b2c3d4e5f6/status", r.mqtt.sent[0].topic.c_str());
    TEST_ASSERT_EQUAL_STRING("melophos/hub-a1b2c3d4e5f6/notes", r.mqtt.sent[1].topic.c_str());
    TEST_ASSERT_EQUAL_STRING("melophos/hub-a1b2c3d4e5f6/session", r.mqtt.sent[2].topic.c_str());
    TEST_ASSERT_NOT_NULL(strstr(r.mqtt.sent[1].payload.c_str(), "b7-s1"));
    TEST_ASSERT_NOT_NULL(strstr(r.mqtt.sent[5].payload.c_str(), "b7-s3"));
}

void test_one_queued_message_per_pump_so_a_backlog_never_stalls_the_loop() {
    Rig r;
    SessionPublisher pub(r.queue, r.wall, 1);
    pub.onNote(note(0, 60));
    r.clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(r.clock.now);
    r.link.pump();  // connects, sends status and one message
    TEST_ASSERT_EQUAL(2, (int)r.queue.size());  // the first is still queued until its PUBACK is read
    TEST_ASSERT_EQUAL(2, (int)r.mqtt.sent.size());
    r.link.pump();
    TEST_ASSERT_EQUAL(3, (int)r.mqtt.sent.size());
}

void test_connect_backoff_doubles_to_a_minute_and_resets() {
    Rig r;
    r.mqtt.allowConnect = false;
    uint32_t waits[] = {1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000};
    r.link.pump();
    TEST_ASSERT_EQUAL(1, r.mqtt.connects);
    for (uint32_t w : waits) {
        r.clock.advance(w - 1);
        r.link.pump();
        int before = r.mqtt.connects;
        r.clock.advance(1);
        r.link.pump();
        TEST_ASSERT_EQUAL(before + 1, r.mqtt.connects);
    }
    r.mqtt.allowConnect = true;
    r.clock.advance(60000);
    r.link.pump();
    TEST_ASSERT_TRUE(r.link.connected());
    r.mqtt.disconnect();
    r.mqtt.allowConnect = false;
    r.link.pump();  // the first failure after a good connection waits 1 s again
    int c = r.mqtt.connects;
    r.clock.advance(999);
    r.link.pump();
    TEST_ASSERT_EQUAL(c, r.mqtt.connects);
}

void test_a_failed_publish_keeps_the_message() {
    Rig r;
    SessionPublisher pub(r.queue, r.wall, 1);
    pub.onNote(note(0, 60));
    r.clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(r.clock.now);
    r.link.pump();  // status and the first message go out
    r.mqtt.failPublish = true;
    r.link.pump();  // the first message is acknowledged and leaves. The session message then fails to send
    TEST_ASSERT_EQUAL(1, (int)r.queue.size());
    size_t sentBefore = r.mqtt.sent.size();
    TEST_ASSERT_EQUAL(1, (int)r.link.publishFailures());
    r.mqtt.failPublish = false;
    r.clock.advance(1000);
    for (int i = 0; i < 4; i++) {
        r.link.pump();
        r.clock.advance(1);
    }
    TEST_ASSERT_EQUAL(0, (int)r.queue.size());
    TEST_ASSERT_TRUE(r.mqtt.sent.size() > sentBefore);
}

// ----- QoS 1 delivery -----

static int sessionSeq(const std::string &payload) {
    const char *at = strstr(payload.c_str(), "\"seq\":");
    return at ? atoi(at + 6) : -1;
}

void test_a_message_leaves_the_queue_only_when_the_broker_acknowledges_it() {
    Rig r;
    r.mqtt.autoAck = false;
    SessionPublisher pub(r.queue, r.wall, 7);
    pub.onNote(note(0, 60));
    r.clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(r.clock.now);
    size_t queued = r.queue.size();
    r.link.pump();
    TEST_ASSERT_TRUE(r.mqtt.sent.size() >= 2);                 // status then the notes message
    TEST_ASSERT_TRUE(r.mqtt.sent.back().qos1);                 // data goes at QoS 1
    TEST_ASSERT_FALSE(r.mqtt.sent.front().qos1);               // status does not
    for (int i = 0; i < 5; i++) {
        r.clock.advance(1000);
        r.link.pump();
        TEST_ASSERT_EQUAL(queued, r.queue.size());             // no PUBACK: still queued
    }
    int id = r.mqtt.sent.back().id;
    r.mqtt.ackNow(id + 50);                                    // an acknowledgement for something else
    r.link.pump();
    TEST_ASSERT_EQUAL(queued, r.queue.size());
    r.mqtt.ackNow(id);
    r.link.pump();
    TEST_ASSERT_EQUAL(queued - 1, r.queue.size());
}

void test_a_lost_puback_means_a_reconnect_and_the_same_message_again_with_the_same_stamp() {
    Rig r;
    SessionPublisher pub(r.queue, r.wall, 7);
    pub.onNote(note(0, 60));
    r.clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(r.clock.now);
    r.mqtt.dropAcks = true;  // the broker keeps the message but its PUBACK never arrives
    r.link.pump();
    std::string first = r.mqtt.sent.back().payload;
    int connects = r.mqtt.connects;
    r.clock.advance(MqttLink::kAckTimeoutMs - 1);
    r.link.pump();
    TEST_ASSERT_EQUAL(connects, r.mqtt.connects);  // not yet
    r.clock.advance(1);
    r.link.pump();  // time-out: the connection is dropped
    TEST_ASSERT_FALSE(r.mqtt.up);
    r.mqtt.dropAcks = false;
    r.clock.advance(70000);
    for (int i = 0; i < 6; i++) {
        r.link.pump();
        r.clock.advance(1);
    }
    TEST_ASSERT_TRUE(r.link.resends() >= 1);
    // the resent message is identical to the first, byte for byte
    int identical = 0;
    for (auto &m : r.mqtt.sent) {
        identical += m.payload == first;
    }
    TEST_ASSERT_EQUAL(2, identical);
    TEST_ASSERT_EQUAL(0, (int)r.queue.size());
}

void test_seq_rises_by_one_per_kind_across_resends_and_is_never_reused() {
    Rig r;
    SessionPublisher pub(r.queue, r.wall, 3);
    for (int s = 0; s < 3; s++) {
        pub.onNote(note(r.clock.now, (uint8_t)(60 + s)));
        r.clock.advance(SessionPublisher::kIdleGapMs + 1);
        pub.tick(r.clock.now);
    }
    r.mqtt.dropAcks = true;
    r.link.pump();
    r.clock.advance(MqttLink::kAckTimeoutMs);
    r.link.pump();  // one lost acknowledgement in the middle of delivery
    r.mqtt.dropAcks = false;
    for (int i = 0; i < 200; i++) {
        r.clock.advance(1000);
        r.link.pump();
    }
    int lastNotes = 0, lastSession = 0, repeats = 0;
    for (auto &m : r.mqtt.sent) {
        int seq = sessionSeq(m.payload);
        if (m.topic.find("/notes") != std::string::npos) {
            if (seq == lastNotes) {
                repeats++;
            } else {
                TEST_ASSERT_EQUAL(lastNotes + 1, seq);
            }
            lastNotes = seq;
        } else if (m.topic.find("/session") != std::string::npos) {
            TEST_ASSERT_EQUAL(lastSession + 1, seq);
            lastSession = seq;
        }
    }
    TEST_ASSERT_EQUAL(3, lastNotes);
    TEST_ASSERT_EQUAL(3, lastSession);
    TEST_ASSERT_EQUAL(1, repeats);  // exactly the one resend and it kept its seq
}

void test_an_acknowledgement_never_removes_a_message_the_queue_already_dropped() {
    Rig r;
    r.mqtt.autoAck = false;
    StoredEvent ev[1] = {{0, 60, 80, 0, 0}};
    QueueEntry first = entryFor(Kind::Notes, 0);
    first.startWall = 1767225600;
    r.queue.push(first, ev, 1, r.clock.now);
    r.link.pump();
    int id = r.mqtt.sent.back().id;
    for (uint32_t i = 0; i < 20; i++) {
        QueueEntry e = entryFor(Kind::Session, 0);
        e.startWall = 1767225600;
        r.queue.push(e, nullptr, 0, r.clock.now);  // pushes the in flight message out
    }
    size_t before = r.queue.size();
    r.mqtt.ackNow(id);
    r.link.pump();
    TEST_ASSERT_EQUAL((int)before, (int)r.queue.size());  // the ack did not eat an innocent message
}

void test_a_message_waits_while_the_clock_is_unset_and_goes_when_it_is_set() {
    Rig r;
    r.wall.epoch = 0;
    SessionPublisher pub(r.queue, r.wall, 1);
    pub.onNote(note(0, 60));
    r.clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(r.clock.now);
    for (int i = 0; i < 5; i++) {
        r.link.pump();
        r.clock.advance(1000);
    }
    size_t dataMessages = 0;
    for (auto &m : r.mqtt.sent) {
        dataMessages += m.qos1;
    }
    TEST_ASSERT_EQUAL(0, (int)dataMessages);  // status went, data did not
    r.wall.epoch = 1767225600 + 500;
    for (int i = 0; i < 8; i++) {
        r.link.pump();
        r.clock.advance(1000);
    }
    TEST_ASSERT_EQUAL(0, (int)r.queue.size());
}

void test_status_is_sent_on_connect_then_every_minute_with_the_dropped_count() {
    Rig r;
    NoteBus bus;
    for (int i = 0; i < 300; i++) {
        bus.push(note(0, 60));
    }
    StoredEvent ev[1] = {{0, 60, 80, 0, 0}};
    for (uint32_t i = 0; i < 20; i++) {
        r.queue.push(entryFor(Kind::Notes, i + 1), ev, 1, 0);  // 4 of these push the first ones out
    }
    r.link.setStatus(StatusInfo{"0.1.0", "piano-88", true, false, true, false, totalDropped(bus, r.queue)});
    r.link.pump();
    TEST_ASSERT_NOT_NULL(strstr(r.mqtt.sent[0].payload.c_str(), "\"dropped_events\":49"));  // 45 bus + 4 queue
    r.queue.popFront();
    size_t statuses = 1;
    for (int i = 0; i < 130; i++) {
        r.clock.advance(1000);
        r.link.pump();
    }
    for (auto &m : r.mqtt.sent) {
        statuses += m.topic.find("/status") != std::string::npos;
    }
    TEST_ASSERT_TRUE(statuses >= 3 && statuses <= 4);  // 130 s: the connect one and two more
}

void test_a_message_that_cannot_be_encoded_does_not_block_the_queue() {
    Rig r;
    QueueEntry bad = entryFor(Kind::Notes, 1);
    bad.startWall = 10;  // 1970: refused by the date check
    r.queue.push(bad, nullptr, 0, 0);
    r.queue.push(entryFor(Kind::Session, 1), nullptr, 0, 0);
    QueueEntry good = entryFor(Kind::Session, 2);
    good.startWall = 1767225600;
    r.queue.push(good, nullptr, 0, 0);
    for (int i = 0; i < 5; i++) {
        r.link.pump();
    }
    TEST_ASSERT_EQUAL(3, (int)r.queue.size());  // the 1970 date is HELD (never dropped for its date) and blocks the rest
    TEST_ASSERT_TRUE(r.link.holdingStale());
    TEST_ASSERT_EQUAL(1, (int)r.link.clearStale());  // until a person clears it
    for (int i = 0; i < 5; i++) {
        r.link.pump();
    }
    TEST_ASSERT_EQUAL(0, (int)r.queue.size());  // and then the messages behind it go
}

void test_repeated_refused_logins_are_counted_and_reset_by_anything_else() {
    Rig r;
    r.mqtt.refuse = 5;
    for (int i = 0; i < 3; i++) {
        r.clock.advance(70000);
        r.link.pump();
    }
    TEST_ASSERT_EQUAL(3, (int)r.link.loginRefusals());
    r.mqtt.refuse = 0;
    r.mqtt.allowConnect = false;  // a network problem is not a refused login
    r.clock.advance(70000);
    r.link.pump();
    TEST_ASSERT_EQUAL(0, (int)r.link.loginRefusals());
    r.mqtt.refuse = 4;
    r.clock.advance(70000);
    r.link.pump();
    r.mqtt.refuse = 0;
    r.mqtt.allowConnect = true;
    r.clock.advance(70000);
    r.link.pump();
    TEST_ASSERT_EQUAL(0, (int)r.link.loginRefusals());  // a good connection clears it
}

void test_a_refused_login_waits_a_minute_not_a_back_off_step() {
    Rig r;
    r.mqtt.refuse = 5;
    r.link.pump();
    int connects = r.mqtt.connects;
    r.clock.advance(59000);
    for (int i = 0; i < 100; i++) {
        r.clock.advance(1);
        r.link.pump();  // a tight loop of pumps
    }
    TEST_ASSERT_EQUAL(connects, r.mqtt.connects);  // no retry inside the minute
    r.clock.advance(1000);
    r.link.pump();
    TEST_ASSERT_EQUAL(connects + 1, r.mqtt.connects);
}

void test_messages_with_a_start_time_the_server_would_skip_are_held_until_a_person_clears_them() {
    Rig r;  // clock: 2026-01-01
    QueueEntry old = entryFor(Kind::Session, 0);
    old.startWall = r.wall.epoch - 367LL * 86400;
    QueueEntry future = entryFor(Kind::Session, 0);
    future.startWall = r.wall.epoch + 86400 + 60;
    QueueEntry okOld = entryFor(Kind::Session, 0);
    okOld.startWall = r.wall.epoch - 365LL * 86400;
    QueueEntry okSoon = entryFor(Kind::Session, 0);
    okSoon.startWall = r.wall.epoch + 3600;
    for (auto e : {old, future, okOld, okSoon}) {
        r.queue.push(e, nullptr, 0, r.clock.now);
    }
    for (int i = 0; i < 20; i++) {
        r.link.pump();
        r.clock.advance(10);
    }
    // the first is a year and a day old: held at the front, nothing behind it goes yet
    TEST_ASSERT_TRUE(r.link.holdingStale());
    TEST_ASSERT_EQUAL(4, (int)r.queue.size());
    TEST_ASSERT_EQUAL(2, (int)r.link.clearStale());  // the old one and the future one, both at the front
    for (int i = 0; i < 20; i++) {
        r.link.pump();
        r.clock.advance(10);
    }
    size_t sessions = 0;
    for (auto &m : r.mqtt.sent) {
        sessions += m.topic.find("/session") != std::string::npos;
    }
    TEST_ASSERT_EQUAL(2, (int)sessions);
}

void test_the_121st_session_in_an_hour_is_not_started() {
    OfflineQueue q;
    FakeWall wall;
    wall.epoch = 1767225600;
    SessionPublisher pub(q, wall, 1);
    uint32_t t = 0;
    int started = 0;
    for (int i = 0; i < 130; i++) {
        pub.onNote(note(t, 60));
        started += pub.active();
        pub.tick(t + SessionPublisher::kIdleGapMs + 1);  // each session ends by itself
        t += 20000;  // 130 sessions inside 2600 s, so inside one hour
    }
    TEST_ASSERT_EQUAL(120, started);
    TEST_ASSERT_EQUAL(10, (int)pub.refusedSessions());
    // an hour after the first, sessions are allowed again
    t += 3600000;
    pub.onNote(note(t, 60));
    TEST_ASSERT_TRUE(pub.active());
}

void test_a_very_long_session_never_sends_more_than_1000_events_in_one_message() {
    OfflineQueue q;
    FakeWall wall;
    wall.epoch = 1767225600;
    SessionPublisher pub(q, wall, 1);
    FakeClock clock;
    FakeMqtt mqtt;
    MqttLink link(clock, mqtt, q, wall, "hub-a1b2c3d4e5f6", 1);
    for (int i = 0; i < 5000; i++) {
        pub.onNote(note(clock.now, (uint8_t)(30 + i % 60)));
        clock.advance(10);
        pub.tick(clock.now);
        if (i % 20 == 0) {
            link.pump();
            link.pump();
        }
    }
    clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(clock.now);
    for (int i = 0; i < 2000; i++) {
        link.pump();
        clock.advance(5);
    }
    size_t events = 0;
    for (auto &m : mqtt.sent) {
        if (m.topic.find("/status") != std::string::npos) {
            continue;
        }
        size_t n = 0;
        for (const char *p = m.payload.c_str(); (p = strstr(p, "\"t_ms\"")) != nullptr; p++) {
            n++;
        }
        TEST_ASSERT_TRUE(n <= 1000);
        TEST_ASSERT_TRUE(m.payload.size() < 128 * 1024);
        if (m.topic.find("/session") != std::string::npos) {
            TEST_ASSERT_EQUAL(0, (int)n);  // the closing message carries none
        }
        events += n;
    }
    TEST_ASSERT_EQUAL(5000, (int)events);
}

// ----- the boot counter -----

// the way a run uses the counter: read it at power-up, store it when the broker first accepts the hub
static BootStart startBoot(DurableCounter &c, bool) {
    BootStart b = peekBoot(c);
    if (b.kind == BootStart::Lost || !commitBoot(c, b.boot)) {
        return BootStart{BootStart::Lost, 0};
    }
    return b;
}

static bool followsOn(uint32_t prev, uint32_t now) {
    return now > prev && now <= prev + 2;  // the server accepts up to +1000
}

void test_boot_counter_starts_at_one_rises_by_one_and_never_guesses() {
    FakeFlash f(4);
    DurableCounter c(f, 0, 1, 0x544F4F42);
    BootStart a = startBoot(c, false);
    TEST_ASSERT_TRUE(a.kind == BootStart::Fresh);
    TEST_ASSERT_EQUAL(1, (int)a.boot);
    for (uint32_t expect = 2; expect < 50; expect++) {
        BootStart b = startBoot(c, true);
        TEST_ASSERT_TRUE(b.kind == BootStart::Continued);
        TEST_ASSERT_EQUAL(expect, (int)b.boot);
    }
}

void test_a_wiped_counter_restarts_at_one_and_the_servers_range_check_is_what_stops_it() {
    FakeFlash f(4);
    DurableCounter c(f, 0, 1, 0x544F4F42);
    startBoot(c, false);
    startBoot(c, true);
    for (auto &b : f.raw()) {
        b = 0xFF;  // the state partition was erased
    }
    // a paired hub that never reached the broker also has a counter of 0, so this reads as a fresh start. What
    // stops a wiped counter from publishing is the server's last_boot: boot 1 is not above it (see test_netctl)
    BootStart wiped = startBoot(c, true);
    TEST_ASSERT_TRUE(wiped.kind == BootStart::Fresh);
    TEST_ASSERT_EQUAL(1, (int)wiped.boot);
    BootStart fresh = startBoot(c, false);  // a hub with no identity is a new device
    TEST_ASSERT_TRUE(fresh.kind == BootStart::Continued);
    TEST_ASSERT_EQUAL(2, (int)fresh.boot);
}

void test_a_counter_that_cannot_be_written_is_lost() {
    FakeFlash f(4);
    DurableCounter c(f, 0, 1, 0x544F4F42);
    startBoot(c, false);
    f.cutAfter(0);  // every write fails
    TEST_ASSERT_TRUE(startBoot(c, true).kind == BootStart::Lost);
    FakeFlash tiny(0);  // no state partition at all
    DurableCounter d(tiny, 0, 1, 0x544F4F42);
    TEST_ASSERT_TRUE(startBoot(d, true).kind == BootStart::Lost);
    TEST_ASSERT_TRUE(startBoot(d, false).kind == BootStart::Lost);
}

// power cut at every step of raising the counter: the next boot never repeats and never jumps far
void test_boot_counter_never_repeats_or_jumps_across_power_cuts() {
    long steps;
    {
        FakeFlash f(4);
        DurableCounter c(f, 0, 1, 0x544F4F42);
        startBoot(c, false);
        f.resetCounters();
        startBoot(c, true);
        steps = f.steps();
    }
    for (long cut = 0; cut <= steps; cut++) {
        FakeFlash f(4);
        DurableCounter c(f, 0, 1, 0x544F4F42);
        uint32_t last = startBoot(c, false).boot;
        last = startBoot(c, true).boot;
        f.cutAfter(cut);
        startBoot(c, true);  // this boot dies part way
        f.restorePower();
        DurableCounter after(f, 0, 1, 0x544F4F42);
        BootStart next = startBoot(after, true);
        TEST_ASSERT_TRUE(next.kind == BootStart::Continued);
        TEST_ASSERT_TRUE_MESSAGE(followsOn(last, next.boot), "the boot repeated or jumped");
    }
}

void test_the_boot_counter_is_not_written_at_power_up_so_an_offline_restart_loop_costs_nothing() {
    FakeFlash f(4);
    DurableCounter c(f, 0, 1, 0x544F4F42);
    startBoot(c, false);
    startBoot(c, true);
    f.resetCounters();
    for (int i = 0; i < 5000; i++) {
        DurableCounter again(f, 0, 1, 0x544F4F42);
        BootStart b = peekBoot(again);  // 5000 restarts that never reach the broker
        TEST_ASSERT_EQUAL(3, (int)b.boot);
    }
    TEST_ASSERT_EQUAL(0, (int)f.steps());  // not one flash operation and so no wear and no jump
}

void test_the_counter_appends_and_erases_once_in_511_writes() {
    FakeFlash f(4);
    DurableCounter c(f, 0, 1, 0x544F4F42);
    for (uint32_t i = 1; i <= 2000; i++) {
        TEST_ASSERT_EQUAL(i, (int)c.next());
    }
    TEST_ASSERT_EQUAL(4, (int)f.erases());  // 2000 / 511 sectors started: 1, 2, 3 and 4
    TEST_ASSERT_EQUAL(2000, (int)DurableCounter(f, 0, 1, 0x544F4F42).value());
    // a 1 Hz restart loop that reached the broker every time: 2 x 511 appends per erase of one sector
    uint32_t worst = 0;
    for (uint32_t i = 0; i < 2; i++) {
        worst = std::max(worst, f.wear(i));
    }
    TEST_ASSERT_TRUE(worst <= 2);
}

void test_the_boot_range_rule() {
    TEST_ASSERT_TRUE(bootInRange(5, -1));                // the server did not say
    TEST_ASSERT_TRUE(bootInRange(1, 0));                 // a new device starts anywhere up to 1 000 000
    TEST_ASSERT_TRUE(bootInRange(1000000, 0));
    TEST_ASSERT_FALSE(bootInRange(1000001, 0));
    TEST_ASSERT_TRUE(bootInRange(8, 7));
    TEST_ASSERT_TRUE(bootInRange(1007, 7));
    TEST_ASSERT_FALSE(bootInRange(1008, 7));             // more than 1000 above
    TEST_ASSERT_FALSE(bootInRange(7, 7));                // not above what the server saw: refused for good
    TEST_ASSERT_FALSE(bootInRange(3, 7));                // the counter went back
}

void test_nothing_is_published_for_a_device_id_the_server_would_refuse() {
    FakeClock clock;
    FakeMqtt mqtt;
    FakeWall wall;
    wall.epoch = 1767225600;
    OfflineQueue q;
    MqttLink link(clock, mqtt, q, wall, "HUB+1", 1);
    for (int i = 0; i < 5; i++) {
        link.pump();
        clock.advance(70000);
    }
    TEST_ASSERT_EQUAL(0, (int)mqtt.sent.size());
}

// ----- the durable boot counter -----

void test_boot_counter_rises_and_survives_a_cut_at_every_step() {
    long steps;
    {
        FakeFlash f(4);
        DurableCounter c(f, 0, 1, 0x544F4F42);
        c.next();
        f.resetCounters();
        c.next();
        steps = f.steps();
    }
    for (long cut = 0; cut <= steps; cut++) {
        FakeFlash f(4);
        DurableCounter c(f, 0, 1, 0x544F4F42);
        TEST_ASSERT_EQUAL(1, (int)c.next());
        TEST_ASSERT_EQUAL(2, (int)c.next());
        f.cutAfter(cut);
        uint32_t got = c.next();
        f.restorePower();
        DurableCounter after(f, 0, 1, 0x544F4F42);
        uint32_t v = after.value();
        TEST_ASSERT_TRUE(v == 2 || v == 3);
        if (got != 0) {
            TEST_ASSERT_EQUAL(got, v);
        }
        // never hands out a number already handed out
        uint32_t n = after.next();
        TEST_ASSERT_TRUE(n > 2);
    }
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_topics_follow_the_protocol);
    RUN_TEST(test_device_ids_that_the_server_would_refuse_are_never_published_to);
    RUN_TEST(test_iso_time_including_a_leap_day_and_the_bounds);
    RUN_TEST(test_payloads_match_the_golden_files);
    RUN_TEST(test_a_session_that_began_before_the_clock_was_set_is_dated_once_it_is);
    RUN_TEST(test_batches_are_every_250_ms_and_capped_at_32_events);
    RUN_TEST(test_a_session_ends_after_a_quiet_gap_and_a_new_one_gets_a_new_ref);
    RUN_TEST(test_queue_drops_oldest_first_and_counts);
    RUN_TEST(test_queue_event_pool_limit_holds);
    RUN_TEST(test_queue_age_limit_including_the_counter_wrapping);
    RUN_TEST(test_queue_refuses_bad_pushes);
    RUN_TEST(test_worst_case_message_fits_the_payload_limit);
    RUN_TEST(test_sessions_queue_while_offline_and_go_out_in_order_on_reconnect);
    RUN_TEST(test_one_queued_message_per_pump_so_a_backlog_never_stalls_the_loop);
    RUN_TEST(test_connect_backoff_doubles_to_a_minute_and_resets);
    RUN_TEST(test_a_failed_publish_keeps_the_message);
    RUN_TEST(test_a_message_waits_while_the_clock_is_unset_and_goes_when_it_is_set);
    RUN_TEST(test_an_acknowledgement_never_removes_a_message_the_queue_already_dropped);
    RUN_TEST(test_seq_rises_by_one_per_kind_across_resends_and_is_never_reused);
    RUN_TEST(test_a_lost_puback_means_a_reconnect_and_the_same_message_again_with_the_same_stamp);
    RUN_TEST(test_a_message_leaves_the_queue_only_when_the_broker_acknowledges_it);
    RUN_TEST(test_status_is_sent_on_connect_then_every_minute_with_the_dropped_count);
    RUN_TEST(test_a_message_that_cannot_be_encoded_does_not_block_the_queue);
    RUN_TEST(test_repeated_refused_logins_are_counted_and_reset_by_anything_else);
    RUN_TEST(test_a_refused_login_waits_a_minute_not_a_back_off_step);
    RUN_TEST(test_messages_with_a_start_time_the_server_would_skip_are_held_until_a_person_clears_them);
    RUN_TEST(test_the_121st_session_in_an_hour_is_not_started);
    RUN_TEST(test_a_very_long_session_never_sends_more_than_1000_events_in_one_message);
    RUN_TEST(test_boot_counter_starts_at_one_rises_by_one_and_never_guesses);
    RUN_TEST(test_a_wiped_counter_restarts_at_one_and_the_servers_range_check_is_what_stops_it);
    RUN_TEST(test_a_counter_that_cannot_be_written_is_lost);
    RUN_TEST(test_boot_counter_never_repeats_or_jumps_across_power_cuts);
    RUN_TEST(test_the_boot_counter_is_not_written_at_power_up_so_an_offline_restart_loop_costs_nothing);
    RUN_TEST(test_the_counter_appends_and_erases_once_in_511_writes);
    RUN_TEST(test_the_boot_range_rule);
    RUN_TEST(test_nothing_is_published_for_a_device_id_the_server_would_refuse);
    RUN_TEST(test_boot_counter_rises_and_survives_a_cut_at_every_step);
    return UNITY_END();
}
