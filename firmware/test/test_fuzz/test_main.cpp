// time-boxed fuzzing of everything that parses bytes from outside. Run it under
// the sanitizers with `pio test -e native-sanitize -f test_fuzz`. The time per
// target is MELOPHOS_FUZZ_SECONDS (default 1 so the ordinary test run stays
// quick). The seed is printed so a failure can be replayed with MELOPHOS_FUZZ_SEED.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include <chrono>
#include <random>
#include <string>
#include <vector>

#include "../support/fakes.h"
#include "monocypher-ed25519.h"
#include "ota.h"
#include "outbox.h"
#include "provision.h"
#include "tlscheck.h"
#include "hub.h"
#include "practice.h"
#include "render.h"
#include "profilecmd.h"

using namespace melophos;
using Clock_ = std::chrono::steady_clock;

static uint64_t seed;
static double seconds() {
    const char *s = getenv("MELOPHOS_FUZZ_SECONDS");
    return s ? atof(s) : 1.0;
}

void setUp() {}
void tearDown() {}

#define FUZZ_LOOP(rng) \
    std::mt19937_64 rng(seed + __LINE__); \
    auto fuzzEnd = Clock_::now() + std::chrono::milliseconds((long)(seconds() * 1000)); \
    for (unsigned long iteration = 0; Clock_::now() < fuzzEnd; iteration++, (void)iteration)

static std::vector<uint8_t> noise(std::mt19937_64 &rng, size_t max) {
    std::vector<uint8_t> v(rng() % (max + 1));
    int mode = (int)(rng() % 4);
    for (auto &b : v) {
        // mode 0 uniform, 1 mostly status bytes, 2 mostly data bytes, 3 note-like
        uint8_t r = (uint8_t)rng();
        b = mode == 0 ? r : mode == 1 ? (uint8_t)(0x80 | (r & 0x7F)) : mode == 2 ? (uint8_t)(r & 0x7F) : (uint8_t)((r % 5 == 0) ? (0x80 | (r & 0x3F)) : (r & 0x7F));
    }
    return v;
}

void test_fuzz_midi_byte_stream() {
    FUZZ_LOOP(rng) {
        MidiParser p(NoteSource::MidiJack);
        NoteBus bus;
        BusSink sink(bus);
        uint32_t t = 0;
        for (auto b : noise(rng, 600)) {
            t += (uint32_t)(rng() % 3 == 0 ? rng() % 2000 : 1);
            p.feed(b, t, sink);
        }
        NoteEvent e;
        while (bus.pop(e)) {
            TEST_ASSERT_TRUE(e.note < 128 && e.velocity < 128 && e.channel < 16);
        }
    }
}

void test_fuzz_usb_packets() {
    FUZZ_LOOP(rng) {
        UsbMidiParser p;
        CollectSink s;
        auto v = noise(rng, 300);
        p.feedTransfer(v.data(), v.size(), 0, s);
        for (auto &e : s.notes) {
            TEST_ASSERT_TRUE(e.note < 128 && e.velocity < 128 && e.channel < 16);
        }
    }
}

void test_fuzz_ble_packets_through_the_link() {
    FUZZ_LOOP(rng) {
        FakeBlePort port;
        GuideSet guides;
        BleMidiLink link(port, guides);
        link.onConnect();
    link.onEncrypted(true);
        link.onSubscribe(true);
        for (int k = 0; k < 8; k++) {
            auto v = noise(rng, 64);
            link.onReceive(v.data(), v.size(), (uint32_t)iteration);
            if (rng() % 3 == 0) {
                link.queueOut(NoteEvent{(uint32_t)rng(), (uint8_t)rng(), (uint8_t)rng(), (uint8_t)rng(), NoteSource::UsbMidi});
                link.pump();
            }
        }
    }
}

static const char *kProfile =
    "{\"id\":\"mine\",\"name\":\"My keys\",\"type\":\"keyboard\",\"notes\":{\"lowest\":36,\"highest\":96},"
    "\"geometry\":{\"white_key_mm\":23.5},\"leds\":{\"layout\":\"strip\",\"density_per_m\":144,\"offset\":2,\"reversed\":false}}";

void test_fuzz_profile_json_never_yields_an_unsafe_profile() {
    FUZZ_LOOP(rng) {
        std::string s = kProfile;
        int edits = 1 + (int)(rng() % 6);
        for (int k = 0; k < edits && !s.empty(); k++) {
            size_t at = rng() % s.size();
            switch (rng() % 5) {
                case 0:
                    s[at] = (char)rng();
                    break;
                case 1:
                    s.erase(at, rng() % 8);
                    break;
                case 2:
                    s.insert(at, std::string(1 + rng() % 3, "0123456789.-e\"{}[],:"[rng() % 20]));
                    break;
                case 3:
                    s.resize(at);
                    break;
                default:
                    s.insert(at, std::to_string((long long)rng()));
            }
        }
        Profile p;
        ProfileResult r = parseProfile(s.data(), s.size(), p);
        if (r.ok) {
            // whatever was accepted must be safe to hand to the LED mapper
            TEST_ASSERT_TRUE(p.lowest <= p.highest || p.type == ProfileType::Fretboard);
            int leds = profileLedCount(p);
            TEST_ASSERT_TRUE(leds >= 1 && leds <= 180);
            if (p.type == ProfileType::Keyboard) {
                KeyboardProfile k = toKeyboardProfile(p);
                for (int n = 0; n < 128; n++) {
                    int idx = ledIndexForNote(k, (uint8_t)n);
                    TEST_ASSERT_TRUE(idx == -1 || (idx >= 0 && idx < 180));
                }
            }
        } else {
            TEST_ASSERT_TRUE(strlen(r.message) > 0);
        }
    }
}

void test_fuzz_profile_commands_and_hostile_flash() {
    FUZZ_LOOP(rng) {
        FakeFlash flash;
        for (auto &b : flash.raw()) {
            if (rng() % 3 == 0) {
                b = (uint8_t)rng();  // a chip full of garbage, with some erased runs
            }
        }
        ProfileStore store(flash);
        store.begin();
        char reply[300];
        std::string cmd;
        const char *verbs[] = {"list", "switch ", "put ", "remove ", "x"};
        cmd = verbs[rng() % 5];
        auto v = noise(rng, 100);
        cmd.append(v.begin(), v.end());
        handleProfileCommand(store, cmd.data(), cmd.size(), reply, sizeof reply, nullptr);
        cmd = std::string("put ") + kProfile;
        handleProfileCommand(store, cmd.data(), cmd.size(), reply, sizeof reply, nullptr);
        Profile active = store.activeOrDefault();
        TEST_ASSERT_TRUE(profileLedCount(active) >= 1 && profileLedCount(active) <= 180);
    }
}

void test_fuzz_practice_engine_and_hub() {
    static const LessonStep steps[] = {{0, 1, {60}, 0}, {4, 2, {62, 64}, 0}, {8, 4, {60, 64, 67, 72}, 0}, {20, 1, {127}, 0}};
    FUZZ_LOOP(rng) {
        FakeClock clock;
        FakeLedSink sink;
        NoteBus bus;
        PracticeHub hub(clock, sink, bus, 88);
        hub.setProfile(KeyboardProfile{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false});
        PracticeSettings s;
        s.bpm = (uint16_t)(30 + rng() % 211);
        s.reducedMotion = rng() % 2;
        char msg[80];
        Mode m = (Mode)(rng() % 4);
        hub.engine().start(m, Lesson{steps, 4}, s, 0, msg, sizeof msg);
        for (int k = 0; k < 400; k++) {
            clock.advance((uint32_t)(rng() % 400));
            if (rng() % 2) {
                bus.push(NoteEvent{clock.now, (uint8_t)rng(), (uint8_t)rng(), (uint8_t)rng(), NoteSource::UsbMidi});
            }
            hub.step();
            // power ceiling holds on whatever the engine produced
            if (!sink.last.empty()) {
                TEST_ASSERT_TRUE(estimateMilliamps(sink.last.data(), sink.last.size()) <= 2700);
            }
        }
    }
}

void test_fuzz_publisher_and_queue() {
    FUZZ_LOOP(rng) {
        OfflineQueue q;
        FakeWall wall;
        wall.epoch = (rng() % 2) ? 1767225600 : 0;
        SessionPublisher pub(q, wall, (uint32_t)rng());
        uint32_t t = (uint32_t)rng();
        for (int k = 0; k < 500; k++) {
            t += (uint32_t)(rng() % 5 == 0 ? rng() % 300000 : rng() % 100);
            pub.onNote(NoteEvent{t, (uint8_t)(rng() % 128), (uint8_t)(rng() % 128), (uint8_t)(rng() % 16), (NoteSource)(rng() % 5)});
            pub.tick(t);
            TEST_ASSERT_TRUE(q.size() <= OfflineQueue::kMaxMessages && q.events() <= OfflineQueue::kMaxEvents);
        }
        QueueEntry e;
        while (q.front(e)) {
            StringSink out;
            encodeEntry(q, e, wall.epoch, t, out);
            TEST_ASSERT_TRUE(out.text.size() < MqttLink::kMaxPayload);
            q.popFront();
        }
    }
}

void test_fuzz_update_image_stream() {
    uint8_t secret[64], pub[32], sd[32];
    std::random_device rd;
    for (auto &b : sd) {
        b = (uint8_t)rd();
    }
    crypto_ed25519_key_pair(secret, pub, sd);
    FUZZ_LOOP(rng) {
        std::vector<uint8_t> image(1 + rng() % 3000);
        for (auto &b : image) {
            b = (uint8_t)rng();
        }
        std::vector<uint8_t> m(kManifestBytes, 0);
        memcpy(m.data(), "MLPH", 4);
        m[4] = 1;
        m[5] = kBoardS3;
        uint32_t size = (uint32_t)image.size();
        memcpy(&m[12], &size, 4);
        uint32_t ver = 2;
        memcpy(&m[8], &ver, 4);
        crypto_sha512(&m[16], image.data(), image.size());
        crypto_ed25519_sign(&m[kSignedBytes], secret, m.data(), kSignedBytes);
        FakeSlot slot;
        slot.cap = 4096;
        Updater u(slot, pub, kBoardS3);
        TEST_ASSERT_EQUAL(UpdateError::None, u.start(m.data(), m.size(), 1, 0, 0));
        // random chunking and one random corruption half the time
        std::vector<uint8_t> sent = image;
        bool corrupt = rng() % 2;
        if (corrupt) {
            sent[rng() % sent.size()] ^= (uint8_t)(1 + rng() % 255);
        }
        size_t at = 0;
        UpdateError e = UpdateError::None;
        while (at < sent.size() && e == UpdateError::None) {
            size_t n = 1 + rng() % 700;
            n = std::min(n, sent.size() - at);
            e = u.feed(sent.data() + at, n);
            at += n;
        }
        if (e == UpdateError::None) {
            e = u.finish();
        }
        TEST_ASSERT_TRUE((e == UpdateError::None) == !corrupt);
        TEST_ASSERT_EQUAL(corrupt ? 0 : 1, slot.commits);
    }
}

void test_fuzz_mqtt_packets_from_the_broker() {
    FUZZ_LOOP(rng) {
        FakeClock clock;
        FakeTransport tr;
        tr.clock = &clock;
        MqttWireConfig cfg{"h", 1, "hub-abc", "hub-abc", "s3cretpass", 30};
        MqttWireClient c(clock, tr, cfg);
        bool up = c.connect();
        TEST_ASSERT_TRUE(up);
        for (int k = 0; k < 20; k++) {
            auto v = noise(rng, 40);
            if (rng() % 2) {  // sometimes a valid packet in the middle of noise
                v.insert(v.begin() + (long)(rng() % (v.size() + 1)), {0x40, 0x02, 0x00, 0x01});
            }
            tr.fromBroker.insert(tr.fromBroker.end(), v.begin(), v.end());
            clock.advance(rng() % 20000);
            c.service();
            const uint8_t body[3] = {1, 2, 3};
            c.publish("melophos/hub-abc/notes", body, 3, rng() % 2);
            int id;
            while (c.pollAck(id)) {
            }
            if (!c.connected()) {
                tr.allowOpen = true;
                c.connect();
            }
        }
    }
}

void test_fuzz_provisioning_commands_and_pem() {
    FUZZ_LOOP(rng) {
        FakeKv kv;
        IdentityStore s(kv);
        const char *verbs[] = {"wifi ", "broker ", "api ", "device ", "ca ", "insecure ", "clear ", "show", "x "};
        std::string cmd = verbs[rng() % 9];
        auto v = noise(rng, 200);
        for (auto b : v) {
            cmd += (char)(b & 0x7F ? b & 0x7F : ' ');
        }
        char reply[300];
        handleProvisionCommand(s, cmd.data(), cmd.size(), reply, sizeof reply);
        TEST_ASSERT_TRUE(strlen(reply) < sizeof reply);
        auto w = noise(rng, 3200);
        validPem((const char *)w.data(), w.size());
        uint8_t out[64];
        base64Decode((const char *)w.data(), w.size(), out, sizeof out);
        // whatever was stored must read back valid
        char host[80], ssid[40], pass[70];
        uint16_t port;
        if (s.broker(host, sizeof host, port)) {
            TEST_ASSERT_TRUE(port >= 1);
        }
        s.wifi(ssid, sizeof ssid, pass, sizeof pass);
    }
}

void test_fuzz_outbox_garbage_flash_and_cert_dates() {
    FUZZ_LOOP(rng) {
        FakeFlash flash(4);
        for (auto &b : flash.raw()) {
            if (rng() % 2) {
                b = (uint8_t)rng();
            }
        }
        Outbox box(flash, 0);
        static Outbox::Saved saved;
        if (box.load(saved)) {
            TEST_ASSERT_TRUE(saved.count <= Outbox::kMaxEvents);
        }
        CertValidity c{CertTime{(int)(rng() % 3000), (int)(rng() % 20), (int)(rng() % 40), (int)(rng() % 30), (int)(rng() % 70), (int)(rng() % 70)},
                       CertTime{(int)(rng() % 3000), (int)(rng() % 20), (int)(rng() % 40), (int)(rng() % 30), (int)(rng() % 70), (int)(rng() % 70)}};
        CertCheck r = checkValidity(c, (int64_t)rng() % 5000000000LL);
        TEST_ASSERT_TRUE(r != CertCheck::Ok || certEpoch(c.notBefore) >= 0);
    }
}

int main() {
    const char *s = getenv("MELOPHOS_FUZZ_SEED");
    seed = s ? strtoull(s, nullptr, 10) : (uint64_t)std::random_device{}();
    printf("fuzz seed %llu, %.1f s per target\n", (unsigned long long)seed, seconds());
    UNITY_BEGIN();
    RUN_TEST(test_fuzz_midi_byte_stream);
    RUN_TEST(test_fuzz_usb_packets);
    RUN_TEST(test_fuzz_ble_packets_through_the_link);
    RUN_TEST(test_fuzz_profile_json_never_yields_an_unsafe_profile);
    RUN_TEST(test_fuzz_profile_commands_and_hostile_flash);
    RUN_TEST(test_fuzz_practice_engine_and_hub);
    RUN_TEST(test_fuzz_publisher_and_queue);
    RUN_TEST(test_fuzz_update_image_stream);
    RUN_TEST(test_fuzz_mqtt_packets_from_the_broker);
    RUN_TEST(test_fuzz_provisioning_commands_and_pem);
    RUN_TEST(test_fuzz_outbox_garbage_flash_and_cert_dates);
    return UNITY_END();
}
