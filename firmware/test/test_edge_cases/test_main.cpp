// hostile and awkward cases across the modules. each one fails when the rule it covers is weakened.
#include <stdio.h>
#include <string.h>

#include <functional>
#include <unity.h>

#include <string>
#include <vector>

#include "../support/fakes.h"
#include "hub.h"
#include "mqttwire.h"
#include "ota.h"
#include "outbox.h"
#include "mqttlink.h"
#include "profile.h"
#include "recordpair.h"
#include "render.h"
#include "publish.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

// 3: one stray byte from the broker must not poison every later connection
void test_the_mqtt_client_reconnects_after_any_malformed_first_byte() {
    for (int b = 0; b < 256; b++) {
        if (b == 0x20 || b == 0x40 || b == 0xD0) {
            continue;  // these start valid packets
        }
        FakeClock clock;
        FakeTransport t;
        t.clock = &clock;
        MqttWireConfig c{"broker", 8883, "hub-abc", "hub-abc", "secret-123456", 30};
        MqttWireClient w(clock, t, c);
        TEST_ASSERT_TRUE(w.connect());
        t.fromBroker.push_back((uint8_t)b);
        w.service();
        TEST_ASSERT_FALSE_MESSAGE(w.connected(), "a stray byte did not drop the link");
        for (int i = 0; i < 3; i++) {
            TEST_ASSERT_TRUE_MESSAGE(w.connect(), "a later reconnect failed");
            w.disconnect();
        }
    }
}

// 6: every accepted keyboard shape maps every note inside the profile's own LEDs
void test_every_accepted_profile_shape_maps_inside_its_own_led_count() {
    long accepted = 0;
    for (int layout = 0; layout < 2; layout++)
        for (int lo = 0; lo < 128; lo += 3)
            for (int hi = lo; hi < 128; hi += 5)
                for (int wk : {500, 1500, 2350, 5000})
                    for (int dens : {100, 600, 1440, 3000})
                        for (int off : {0, 5, 32})
                            for (int rev = 0; rev < 2; rev++) {
                                Profile p = defaultProfile();
                                p.layout = layout ? ProfileLayout::Strip : ProfileLayout::PerKey;
                                p.lowest = (uint8_t)lo;
                                p.highest = (uint8_t)hi;
                                p.whiteKeyCentiMm = (uint16_t)wk;
                                p.densityDeciPerM = layout ? (uint16_t)dens : 0;
                                p.offset = (uint8_t)off;
                                p.reversed = rev;
                                uint8_t raw[kProfileBytes];
                                Profile q;
                                encodeProfile(p, raw, sizeof raw);
                                if (!decodeProfile(raw, sizeof raw, q)) {
                                    continue;
                                }
                                accepted++;
                                KeyboardProfile k = toKeyboardProfile(q);
                                int count = ledCount(k);
                                int prev = -100;
                                for (int n = lo; n <= hi; n++) {
                                    int i = ledIndexForNote(k, (uint8_t)n);
                                    TEST_ASSERT_TRUE_MESSAGE(i >= 0 && i < count, "a note maps outside the profile's LEDs");
                                    if (layout == 0) {
                                        TEST_ASSERT_TRUE(i != prev);  // one LED per key
                                    }
                                    prev = i;
                                }
                            }
    TEST_ASSERT_TRUE(accepted > 10000);
}

// 5: a restored session carries the times it was saved with
void test_a_restored_session_keeps_its_event_times_when_the_clock_is_not_zero() {
    FakeFlash flash(4);
    FakeWall wall;
    wall.epoch = 1767225600;
    {
        OfflineQueue q;
        SessionPublisher pub(q, wall, 4);
        Outbox box(flash, 0);
        pub.setEndListener(&box);
        for (int i = 0; i < 10; i++) {
            pub.onNote(NoteEvent{(uint32_t)(100000 + i * 500), 60, 80, 0, NoteSource::UsbMidi});
        }
        pub.tick(100000 + 5000);
        pub.tick(100000 + 5000 + SessionPublisher::kIdleGapMs + 1);
    }
    static Outbox::Saved saved;
    Outbox box(flash, 0);
    TEST_ASSERT_TRUE(box.load(saved));
    OfflineQueue q;
    SessionPublisher pub(q, wall, 5);
    pub.restore(saved.ref, saved.profile, saved.mode, saved.startWall, saved.events, saved.count, 1800);  // millis() at the end of setup
    QueueEntry e;
    q.front(e);
    q.stampFront(5, 1);
    q.front(e);
    StringSink s;
    TEST_ASSERT_TRUE(encodeEntry(q, e, 0, 0, s));
    TEST_ASSERT_NOT_NULL(strstr(s.text.c_str(), "\"t_ms\":0,"));
    TEST_ASSERT_NOT_NULL(strstr(s.text.c_str(), "\"t_ms\":500,"));
    TEST_ASSERT_NULL(strstr(s.text.c_str(), "4294"));  // no wrapped negative times
}

// 9: a real-time byte inside a Bluetooth message carries its own timestamp byte
void test_bluetooth_midi_with_a_clock_byte_inside_a_note_on() {
    for (uint8_t ts : {0x82, 0x9A, 0xB0, 0xF0}) {
        uint8_t pkt[] = {0x80, 0x81, 0x90, ts, 0xF8, 0x3C, 0x64};
        BleMidiParser p;
        CollectSink s;
        p.feedPacket(pkt, sizeof pkt, 0, s);
        TEST_ASSERT_EQUAL(1, (int)s.notes.size());
        TEST_ASSERT_EQUAL(60, s.notes[0].note);
        TEST_ASSERT_EQUAL(100, s.notes[0].velocity);
        TEST_ASSERT_EQUAL(0, s.notes[0].channel);
    }
}

// 2: reduced motion switched on in the middle of a session takes effect at once
void test_calm_mode_switched_on_mid_session_removes_the_blink_and_the_dot() {
    static const LessonStep steps[] = {{16, 1, {60}, 0}, {20, 1, {62}, 0}};
    FakeClock clock;
    FakeLedSink sink;
    NoteBus bus;
    PracticeHub hub(clock, sink, bus, 88);
    hub.setProfile(KeyboardProfile{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false});
    RenderSettings rs;
    rs.master = 255;
    hub.setRender(rs);
    char msg[80];
    PracticeSettings ps;
    ps.bpm = 60;
    ps.countInBeats = 0;
    TEST_ASSERT_TRUE(hub.engine().start(Mode::Rhythm, Lesson{steps, 2}, ps, 0, msg, sizeof msg));
    clock.advance(1);
    hub.step();
    hub.setReducedMotion(true);  // what `practice calm on` does
    // a wrong note now: it must be steady, not two flashes
    bus.push(NoteEvent{clock.now, 90, 80, 0, NoteSource::UsbMidi});
    int rising = 0;
    bool wasLit = false;
    for (int t = 0; t < 1200; t++) {
        clock.advance(1);
        hub.step();
        bool lit = sink.last.size() > 69 && sink.last[90 - 21].r > 0;
        rising += lit && !wasLit;
        wasLit = lit;
    }
    TEST_ASSERT_EQUAL(1, rising);  // one steady light, no second flash
    // and the approach dot does not hop: the upcoming light for note 60 sits on its own key only
    int dotKeys = 0;
    for (int t = 0; t < 4500; t++) {
        clock.advance(1);
        hub.step();
        for (int k : {57, 58, 59}) {
            dotKeys += sink.last[(size_t)(k - 21)].b > 0 || sink.last[(size_t)(k - 21)].r > 0;
        }
    }
    TEST_ASSERT_EQUAL(0, dotKeys);
}

void test_a_blink_already_running_turns_steady_when_calm_mode_comes_on() {
    Cue c{60, LightRole::Wrong, 0, false, true, 0};  // started as a blink
    int changes = 0;
    int prev = cueLevel(c, 0, true);
    for (uint32_t t = 1; t < 790; t++) {
        int now = cueLevel(c, t, true);
        changes += now != prev;
        prev = now;
    }
    TEST_ASSERT_EQUAL(0, changes);  // under reduced motion it is one steady light for 800 ms
}

// 7: the all-zero placeholder key must not verify a forged manifest
void test_the_all_zero_key_verifies_nothing() {
    uint8_t key[32] = {0};
    uint8_t m[kManifestBytes];
    for (uint32_t v = 101; v < 140; v++) {
        memset(m, 0, sizeof m);
        memcpy(m, "MLPH", 4);
        m[4] = 1;
        m[5] = kBoardS3;
        m[8] = (uint8_t)v;
        m[9] = (uint8_t)(v >> 8);
        m[12] = 0x00;
        m[13] = 0x10;
        memset(m + 16, 0xAB, 64);
        m[kSignedBytes] = 1;  // R = the neutral point, S = 0
        Manifest out;
        TEST_ASSERT_TRUE(verifyManifest(m, sizeof m, key, kBoardS3, out) != UpdateError::None);
    }
}

// 4: the sign-bit forms of the small-order points
void test_every_form_of_a_small_order_point_is_refused_as_an_update_key() {
    uint8_t zeroHigh[32] = {0};
    zeroHigh[31] = 0x80;  // 00..80
    TEST_ASSERT_FALSE(publicKeyUsable(zeroHigh));
    uint8_t oneHigh[32] = {1};
    oneHigh[31] = 0x80;  // 01..80
    TEST_ASSERT_FALSE(publicKeyUsable(oneHigh));
    for (uint8_t low : {0xEC, 0xED, 0xEE}) {
        for (uint8_t top : {0x7F, 0xFF}) {
            uint8_t k[32];
            memset(k, 0xFF, 32);
            k[0] = low;
            k[31] = top;
            TEST_ASSERT_FALSE_MESSAGE(publicKeyUsable(k), "a small-order form was accepted");
        }
    }
    // and a forged manifest signed against the 00..80 form is refused
    uint8_t m[kManifestBytes];
    memset(m, 0, sizeof m);
    memcpy(m, "MLPH", 4);
    m[4] = 1;
    m[5] = kBoardS3;
    m[8] = 120;
    m[12] = 0x00;
    m[13] = 0x10;
    memset(m + 16, 0xAB, 64);
    m[kSignedBytes] = 1;
    Manifest out;
    TEST_ASSERT_TRUE(verifyManifest(m, sizeof m, zeroHigh, kBoardS3, out) != UpdateError::None);
}

// the logical race in sendFront: a pop on the stale, bad-topic or encode paths must remove the entry it looked
// at, not whatever is at the front by then. A lock that lets another "thread" push between the look and the pop
class InterferingLock : public Lock {
   public:
    std::function<void()> onFront;
    int depth = 0;
    int unlocks = 0;
    int triggerAt = 3;  // expire, resolveTimes, then sendFront's front(): the third locked call of a pump
    void lock() override { depth++; }
    void unlock() override {
        depth--;
        if (depth == 0) {
            unlocks++;
        }
        if (depth == 0 && unlocks == triggerAt && onFront) {
            auto f = onFront;
            onFront = nullptr;
            f();  // runs in the gap after the first locked call returns
        }
    }
};

void test_a_pop_never_removes_a_message_that_replaced_the_one_it_looked_at() {
    // the other thread acts after the Nth locked call of the pump, for every N: wherever it lands, the good
    // message must still be delivered, never removed unseen
    for (int n = 1; n <= 10; n++) {
        FakeClock clock;
        FakeMqtt mqtt;
        FakeWall wall;
        wall.epoch = 1767225600;
        OfflineQueue queue;
        InterferingLock lock;
        lock.triggerAt = n;
        queue.setLock(&lock);
        MqttLink link(clock, mqtt, queue, wall, "hub-a1b2c3d4e5f6", 1);
        QueueEntry stale{};
        stale.kind = (Kind)9;  // a kind with no topic: refused and popped
        strcpy(stale.ref, "old");
        strcpy(stale.profile, "piano-88");
        stale.startWall = 1767225600;
        queue.push(stale, nullptr, 0, 0);
        lock.unlocks = 0;
        lock.onFront = [&] {
            queue.popFront();  // the other thread removes the refused message and queues a good one
            QueueEntry good{};
            good.kind = Kind::Session;
            strcpy(good.ref, "good");
            strcpy(good.profile, "piano-88");
            good.startWall = 1767225600;
            queue.push(good, nullptr, 0, 0);
        };
        for (int i = 0; i < 8; i++) {
            link.pump();
            clock.advance(10);
        }
        int goodSent = 0;
        for (auto &m : mqtt.sent) {
            goodSent += m.payload.find("\"session_ref\":\"good\"") != std::string::npos;
        }
        char msg[100];
        snprintf(msg, sizeof msg, "the good message was lost when the other thread acted at call %d", n);
        TEST_ASSERT_EQUAL_MESSAGE(1, goodSent, msg);
    }
}

void test_the_session_reference_is_unique_across_runs_that_never_reached_the_broker() {
    FakeWall wall;
    wall.epoch = 1767225600;
    OfflineQueue q1, q2;
    SessionPublisher a(q1, wall, 1, 0x1111AAAA);
    SessionPublisher b(q2, wall, 1, 0x2222BBBB);  // the next run: the same boot, because nothing was committed
    a.onNote(NoteEvent{0, 60, 80, 0, NoteSource::UsbMidi});
    b.onNote(NoteEvent{0, 60, 80, 0, NoteSource::UsbMidi});
    a.tick(SessionPublisher::kIdleGapMs + 1);
    b.tick(SessionPublisher::kIdleGapMs + 1);
    QueueEntry ea, eb;
    q1.front(ea);
    q2.front(eb);
    TEST_ASSERT_TRUE(strcmp(ea.ref, eb.ref) != 0);
    // the format the server accepts: 1 to 64 characters of letters, digits, dot, underscore and dash
    for (const char *c = ea.ref; *c; c++) {
        TEST_ASSERT_TRUE((*c >= 'a' && *c <= 'z') || (*c >= '0' && *c <= '9') || *c == '-' || *c == '.' || *c == '_');
    }
    TEST_ASSERT_TRUE(strlen(ea.ref) >= 1 && strlen(ea.ref) <= 64);
}

// N3: one lost bit in the newest log header must not roll the counter back
void test_a_damaged_log_header_makes_the_counter_lost_and_a_torn_one_does_not() {
    FakeFlash f(4);
    DurableCounter c(f, 0, 1, 0x544F4F42);
    for (int i = 0; i < 700; i++) {  // into the second sector
        c.next();
    }
    // the newest sector is sector 1: lose one bit in its header
    f.raw()[4096 + 1] ^= 0x04;
    DurableCounter after(f, 0, 1, 0x544F4F42);
    TEST_ASSERT_TRUE(after.damaged());
    BootStart b = peekBoot(after);
    TEST_ASSERT_TRUE(b.kind == BootStart::Lost);
    TEST_ASSERT_EQUAL(0, (int)after.next());  // and it refuses to hand out a number from an older record
    // a cut during the switch to a new sector (erase, then header) leaves a torn header with nothing behind it
    long steps;
    {
        FakeFlash g(4);
        DurableCounter d(g, 0, 1, 0x544F4F42);
        for (int i = 0; i < 511; i++) d.next();
        g.resetCounters();
        d.next();  // the 512th: erases the other sector and starts it
        steps = g.steps();
    }
    for (long cut = 0; cut <= steps; cut++) {
        FakeFlash g(4);
        DurableCounter d(g, 0, 1, 0x544F4F42);
        for (int i = 0; i < 511; i++) d.next();
        g.cutAfter(cut);
        d.next();
        g.restorePower();
        DurableCounter e(g, 0, 1, 0x544F4F42);
        TEST_ASSERT_FALSE_MESSAGE(e.damaged(), "a power cut was taken for damage");
        BootStart s = peekBoot(e);
        TEST_ASSERT_TRUE(s.kind == BootStart::Continued);
        TEST_ASSERT_TRUE(s.boot == 512 || s.boot == 513);  // never a repeat of one already handed out
    }
}

// a surviving mutation: commitBoot must check that the write landed
class LyingFlash : public FakeFlash {
   public:
    bool program(uint32_t, const void *, size_t) override { return true; }  // says yes, writes nothing
};

void test_commit_boot_notices_a_write_that_did_not_land() {
    LyingFlash f;
    DurableCounter c(f, 0, 1, 0x544F4F42);
    TEST_ASSERT_FALSE(commitBoot(c, 1));
    FakeFlash good(4);
    DurableCounter g(good, 0, 1, 0x544F4F42);
    TEST_ASSERT_TRUE(commitBoot(g, 7));
    TEST_ASSERT_EQUAL(7, (int)g.value());
}

// one flipped bit anywhere in the newest record must never roll the counter back (337 to 336)
void test_one_flipped_bit_in_the_newest_counter_record_never_rolls_the_counter_back() {
    // case 0: the newest record sits mid sector. case 1: it is the first record of a new sector
    for (int onRollover = 0; onRollover < 2; onRollover++) {
        int n = onRollover ? 512 : 337;
        size_t at = onRollover ? 4096 + 8 : 337 * 8;  // slot 0 is the header
        for (int bit = 0; bit < 64; bit++) {
            FakeFlash f(4);
            DurableCounter c(f, 0, 1, 0x544F4F42);
            for (int i = 0; i < n; i++) {
                c.next();
            }
            TEST_ASSERT_EQUAL((uint32_t)n, c.value());
            f.raw()[at + bit / 8] ^= (uint8_t)(1u << (bit % 8));
            DurableCounter after(f, 0, 1, 0x544F4F42);
            uint32_t v = after.value();
            char msg[80];
            snprintf(msg, sizeof msg, "a flipped bit %d rolled the counter back to %u (newest %d)", bit, (unsigned)v, n);
            TEST_ASSERT_TRUE_MESSAGE(after.damaged() || v >= (uint32_t)n, msg);
            uint32_t next = after.next();
            TEST_ASSERT_TRUE_MESSAGE(next == 0 || next > (uint32_t)n, msg);  // never a number that may have been used
        }
    }
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_the_mqtt_client_reconnects_after_any_malformed_first_byte);
    RUN_TEST(test_every_accepted_profile_shape_maps_inside_its_own_led_count);
    RUN_TEST(test_a_restored_session_keeps_its_event_times_when_the_clock_is_not_zero);
    RUN_TEST(test_bluetooth_midi_with_a_clock_byte_inside_a_note_on);
    RUN_TEST(test_calm_mode_switched_on_mid_session_removes_the_blink_and_the_dot);
    RUN_TEST(test_a_blink_already_running_turns_steady_when_calm_mode_comes_on);
    RUN_TEST(test_the_all_zero_key_verifies_nothing);
    RUN_TEST(test_a_pop_never_removes_a_message_that_replaced_the_one_it_looked_at);
    RUN_TEST(test_the_session_reference_is_unique_across_runs_that_never_reached_the_broker);
    RUN_TEST(test_a_damaged_log_header_makes_the_counter_lost_and_a_torn_one_does_not);
    RUN_TEST(test_one_flipped_bit_in_the_newest_counter_record_never_rolls_the_counter_back);
    RUN_TEST(test_commit_boot_notices_a_write_that_did_not_land);
    RUN_TEST(test_every_form_of_a_small_order_point_is_refused_as_an_update_key);
    return UNITY_END();
}
