// the network task's decisions against a model of the server, after a replica of the task
// loop (ten minutes: 87 identities, 0 polls, 258 refused logins). Time moves 20 ms a pass.
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "../support/fakes.h"
#include "netctl.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static const char *kPem = "-----BEGIN CERTIFICATE-----\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END CERTIFICATE-----\n";

// the server as server/app/routers/devices.py behaves: the broker login appears at the first GET /device after the claim
struct Server : public HttpsPort {
    bool claimed = false, brokerLogin = false, failIdentity = false;
    bool autoClaim = false;  // the owner claims every new identity at once
    int polls = 0, requests = 0, deletes = 0;
    int64_t lastBoot = -1;
    int64_t serverTime = 0;  // 0: an older server that sends no server_time
    int syncedField = 0;     // server_time_synced: 0 absent, 1 true, 2 false, 3 null
    bool lastBootNull = false;  // last_boot: null, as the server sends for a hub it has not heard from
    bool requestIdentity(HttpReply &out) override {
        requests++;
        if (failIdentity) {
            out = FakeHttps::reply(500, "");
            return true;
        }
        char b[300];
        snprintf(b, sizeof b, "{\"device_id\":\"hub-%04d\",\"device_secret\":\"mph_abcdefghijklmnop\",\"code\":\"ABCD-EF%02d\",\"expires_in\":600}", requests,
                 requests % 100);
        out = FakeHttps::reply(201, b);
        claimed = autoClaim;
        brokerLogin = false;
        return true;
    }
    bool checkDevice(const char *, const char *, HttpReply &out) override {
        polls++;
        if (claimed) {
            brokerLogin = true;
            char b[200];
            if (lastBootNull) {
                snprintf(b, sizeof b, "{\"paired\":true,\"claimed_by\":\"o***@e***.com\",\"undo_until\":\"2026-11-22T12:15:00Z\",\"last_boot\":null}");
            } else if (lastBoot >= 0) {
                snprintf(b, sizeof b, "{\"paired\":true,\"claimed_by\":\"o***@e***.com\",\"undo_until\":\"2026-11-22T12:15:00Z\",\"last_boot\":%lld}", (long long)lastBoot);
            } else {
                snprintf(b, sizeof b, "{\"paired\":true,\"claimed_by\":\"o***@e***.com\",\"undo_until\":\"2026-11-22T12:15:00Z\"}");
            }
            if (serverTime > 0) {
                size_t n = strlen(b);
                if (n > 0 && b[n - 1] == '}') {
                    snprintf(b + n - 1, sizeof b - n + 1, ",\"server_time\":%lld%s}", (long long)serverTime,
                             syncedField == 1 ? ",\"server_time_synced\":true" : syncedField == 2 ? ",\"server_time_synced\":false" : syncedField == 3 ? ",\"server_time_synced\":null" : "");
                }
            }
            out = FakeHttps::reply(200, b);
        } else {
            out = FakeHttps::reply(200, "{\"paired\":false}");
        }
        return true;
    }
    bool removeClaim(const char *, const char *, HttpReply &out) override {
        deletes++;
        claimed = brokerLogin = false;
        out = FakeHttps::reply(200, "{}");
        return true;
    }
};

// builds the real MqttLink over a fake broker that refuses the login until the server made it
struct ServerMqtt : public FakeMqtt {
    Server &server;
    explicit ServerMqtt(Server &s) : server(s) {}
    bool connect() override {
        refuse = server.brokerLogin ? 0 : 5;  // CONNACK not authorised until the login exists
        return FakeMqtt::connect();
    }
};

struct Platform : public NetPlatform {
    FakeClock &clock;
    Server &server;
    ServerMqtt mqtt;
    FakeWall wall;
    OfflineQueue queue;
    int opened = 0, refusedConnects = 0;
    std::vector<std::string> said;
    Platform(FakeClock &c, Server &s) : clock(c), server(s), mqtt(s) { wall.epoch = 1767225600; }
    void say(const char *l) override { said.push_back(l); }
    MqttLink *openLink(const char *, uint16_t, const char *id, const char *, uint32_t boot, BootCommit *commit) override {
        opened++;
        MqttLink *l = new MqttLink(clock, mqtt, queue, wall, id, boot);
        l->setBootCommit(commit);
        return l;
    }
    void closeLink(MqttLink *l) override { delete l; }
    StatusInfo status() override { return StatusInfo{"0.1.0", "piano-88", true, false, true, false, 0}; }
    void sync() {}
    bool said_(const char *part) const {
        for (auto &s : said) {
            if (s.find(part) != std::string::npos) {
                return true;
            }
        }
        return false;
    }
};

struct Rig {
    FakeClock clock;
    FakeKv kv;
    IdentityStore id{kv};
    FakeFlash flash{4};
    DurableCounter counter{flash, 0, 1, 0x544F4F42};
    Server server;
    ClockWall wall{clock, 1767225600};
    Platform platform{clock, server};
    PairingFsm pairing{clock, server, id, wall};
    NetworkController net{clock, id, pairing, platform, counter};
    Rig() {
        const char *why;
        id.setWifi("HomeNet", "password123", &why);
        id.setBroker("mqtt.example", 8883, &why);
        id.setCa(kPem, strlen(kPem), &why);
        net.begin();
    }
    void pass(bool wifi = true) {
        platform.sync();
        net.step(wifi);
        clock.advance(20);
    }
    void run(int passes, bool wifi = true) {
        for (int i = 0; i < passes; i++) {
            pass(wifi);
        }
    }
};

void test_pairing_finishes_one_identity_polls_until_paired_then_one_broker_login() {
    Rig r;
    int refusalsBeforeClaim = 0;
    for (int pass = 0; pass < 30000; pass++) {  // ten minutes
        if (pass == 1500) {
            r.server.claimed = true;  // the owner types the code 30 s in
        }
        r.pass();
        if (pass < 1500) {
            refusalsBeforeClaim = r.platform.mqtt.connects;
        }
    }
    TEST_ASSERT_EQUAL(1, r.server.requests);           // one identity, not 87
    TEST_ASSERT_TRUE(r.server.polls >= 10);            // it polled GET /device
    TEST_ASSERT_EQUAL(0, refusalsBeforeClaim);         // the broker was never tried before the claim
    TEST_ASSERT_EQUAL(1, r.platform.opened);           // one link and
    TEST_ASSERT_EQUAL(1, r.platform.mqtt.connects);    // one login
    TEST_ASSERT_TRUE(r.platform.mqtt.up);
    TEST_ASSERT_TRUE(r.net.everConnected());
    TEST_ASSERT_TRUE(r.platform.said_("claimed by o***@e***.com"));
}

void test_the_hourly_identity_cap_survives_restarts() {
    FakeClock clock;
    FakeKv kv;
    Server server;
    server.failIdentity = true;  // a server that answers 500, so the hub keeps asking
    int restarts = 0;
    for (; restarts < 60; restarts++) {  // a restart every minute for an hour
        IdentityStore id(kv);
        const char *why;
        id.setWifi("HomeNet", "password123", &why);
        id.setBroker("mqtt.example", 8883, &why);
        id.setCa(kPem, strlen(kPem), &why);
        FakeFlash flash(4);
        DurableCounter counter(flash, 0, 1, 0x544F4F42);
        ClockWall wall(clock, 1767225600);
        Platform platform(clock, server);
        PairingFsm pairing(clock, server, id, wall);
        NetworkController net(clock, id, pairing, platform, counter);
        net.begin();
        for (int i = 0; i < 3000; i++) {  // a minute of passes
            platform.sync();
            net.step(true);
            clock.advance(20);
        }
    }
    TEST_ASSERT_TRUE_MESSAGE(server.requests <= 20, "more than 20 identity requests in an hour");
    TEST_ASSERT_TRUE(server.requests >= 1);
}

void test_a_restart_while_waiting_and_after_pairing_does_not_ask_for_a_second_identity() {
    FakeClock clock;
    FakeKv kv;
    Server server;
    for (int run = 0; run < 3; run++) {
        IdentityStore id(kv);
        const char *why;
        id.setWifi("HomeNet", "password123", &why);
        id.setBroker("mqtt.example", 8883, &why);
        id.setCa(kPem, strlen(kPem), &why);
        FakeFlash flash(4);  // note: a new flash each run would look like a lost counter, so keep one
        static FakeFlash keep(4);
        DurableCounter counter(keep, 0, 1, 0x544F4F42);
        ClockWall wall(clock, 1767225600);
        Platform platform(clock, server);
        PairingFsm pairing(clock, server, id, wall);
        NetworkController net(clock, id, pairing, platform, counter);
        net.begin();
        if (run == 1) {
            server.claimed = true;
        }
        for (int i = 0; i < 1500; i++) {
            platform.sync();
            net.step(true);
            clock.advance(20);
        }
    }
    TEST_ASSERT_EQUAL(1, server.requests);
}

void test_a_boot_is_stored_only_when_the_broker_first_accepts_the_hub() {
    Rig r;
    r.server.autoClaim = true;
    r.flash.resetCounters();
    // wifi down for a long time: the hub restarts over and over and never reaches the broker
    r.run(5000, false);
    TEST_ASSERT_EQUAL(0, (int)r.flash.steps());
    r.run(3000);  // wifi up: pairs, connects
    TEST_ASSERT_TRUE(r.net.everConnected());
    TEST_ASSERT_EQUAL(1, (int)r.counter.value());  // stored now, as boot 1
    TEST_ASSERT_EQUAL(1, (int)r.net.bootNumber());
}

void test_a_lost_counter_and_an_out_of_range_boot_stop_publication_with_a_plain_reason() {
    {
        Rig r;
        r.server.autoClaim = true;
        r.run(3000);
        TEST_ASSERT_TRUE(r.net.everConnected());
        // now the state partition is wiped while the identity stays and the hub restarts
        for (auto &b : r.flash.raw()) {
            b = 0xFF;
        }
        Platform platform2(r.clock, r.server);
        PairingFsm pairing2(r.clock, r.server, r.id, r.wall);
        NetworkController net2(r.clock, r.id, pairing2, platform2, r.counter);
        r.server.lastBoot = 1;  // the server saw boot 1 from this hub
        net2.begin();
        for (int i = 0; i < 3000; i++) {
            platform2.sync();
            net2.step(true);
            r.clock.advance(20);
        }
        // a wiped counter starts at 1 again, which the server's range check refuses with a plain reason
        TEST_ASSERT_EQUAL(0, platform2.mqtt.connects);
        TEST_ASSERT_TRUE(net2.bootOutOfRange());
        TEST_ASSERT_TRUE(platform2.said_("out of the server's range"));
    }
    {
        Rig r;
        r.server.autoClaim = true;
        r.server.lastBoot = 5000;  // the server saw a boot far above what this hub has
        r.run(3000);
        TEST_ASSERT_EQUAL(0, r.platform.mqtt.connects);
        TEST_ASSERT_TRUE(r.net.bootOutOfRange());
        TEST_ASSERT_TRUE(r.platform.said_("out of the server's range"));
    }
    {
        Rig r;
        r.server.autoClaim = true;
        r.server.lastBoot = 0;  // a brand new device on the server
        r.run(3000);
        TEST_ASSERT_TRUE(r.net.everConnected());
    }
}

void test_a_null_last_boot_means_a_new_device_and_the_hub_connects() {
    Rig r;
    r.server.autoClaim = true;
    r.server.lastBootNull = true;
    r.run(3000);
    TEST_ASSERT_TRUE(r.net.everConnected());
    TEST_ASSERT_FALSE(r.net.bootOutOfRange());
}

void test_two_refused_logins_after_the_claim_mean_pair_again() {
    Rig r;
    r.server.autoClaim = true;
    r.run(3000);
    TEST_ASSERT_TRUE(r.net.everConnected());
    r.server.autoClaim = false;
    r.server.claimed = false;
    r.server.brokerLogin = false;  // the owner removed the hub
    r.platform.mqtt.up = false;
    r.run(7000);                    // two refusals a minute apart, then pairing
    TEST_ASSERT_TRUE(r.platform.said_("pairing starts again"));
    TEST_ASSERT_TRUE(r.server.requests >= 2);
}

void test_unclaim_removes_the_claim_and_the_hub_pairs_again() {
    Rig r;
    r.server.autoClaim = true;
    r.run(3000);
    r.server.autoClaim = false;  // the next identity is not claimed by anyone yet
    r.net.requestUnclaim();
    r.run(200);
    TEST_ASSERT_EQUAL(1, r.server.deletes);
    TEST_ASSERT_FALSE(r.net.linkUp());
    TEST_ASSERT_TRUE(r.server.requests >= 2);
}

void test_the_stored_settings_are_read_once_a_second_not_every_pass() {
    // a counting store to see how often the controller reads it
    struct CountingKv : public FakeKv {
        int gets = 0;
        bool get(const char *k, char *o, size_t c, size_t &l) override {
            gets++;
            return FakeKv::get(k, o, c, l);
        }
    };
    FakeClock clock;
    CountingKv kv;
    IdentityStore id(kv);
    Server server;
    ClockWall wall(clock, 1767225600);
    Platform platform(clock, server);
    FakeFlash flash(4);
    DurableCounter counter(flash, 0, 1, 0x544F4F42);
    PairingFsm pairing(clock, server, id, wall);
    NetworkController net(clock, id, pairing, platform, counter);
    net.begin();
    kv.gets = 0;
    for (int i = 0; i < 500; i++) {  // 10 s with no Wi-Fi
        net.step(false);
        clock.advance(20);
    }
    TEST_ASSERT_TRUE(kv.gets < 120);  // about ten checks of ten reads, not 500 x ten
}

// N1: a restart at any step of pairing must not leave the counter "lost" for good
void test_a_restart_at_every_step_of_pairing_still_ends_connected() {
    for (int restartAt : {1, 5, 40, 100, 160, 200, 400, 800, 1500}) {
        FakeClock clock;
        FakeKv kv;
        Server server;
        server.autoClaim = true;
        FakeFlash flash(4);
        bool connected = false;
        for (int run = 0; run < 3 && !connected; run++) {
            IdentityStore id(kv);
            const char *why;
            id.setWifi("HomeNet", "password123", &why);
            id.setBroker("mqtt.example", 8883, &why);
            id.setCa(kPem, strlen(kPem), &why);
            DurableCounter counter(flash, 0, 1, 0x544F4F42);
            ClockWall wall(clock, 1767225600);
            Platform platform(clock, server);
            PairingFsm pairing(clock, server, id, wall);
            NetworkController net(clock, id, pairing, platform, counter);
            net.begin();
            int passes = run == 0 ? restartAt : 4000;  // the first run is cut short, the next must finish
            for (int i = 0; i < passes; i++) {
                platform.sync();
                net.step(true);
                clock.advance(20);
            }
            TEST_ASSERT_FALSE_MESSAGE(net.bootLost(), "a restart during pairing made the counter lost");
            connected = net.everConnected();
        }
        TEST_ASSERT_TRUE_MESSAGE(connected, "no broker connection after a restart during pairing");
    }
}

// a window: paired, the broker not yet reached, then a restart. 467 restart points with the broker
// reachable and unreachable in the first run: none may end Lost
// every restart point is millions of controller steps. The sanitiser build runs many times slower and the
// runner stops it, so there it samples every 30th point, which still lands in every phase of pairing
#if defined(__SANITIZE_ADDRESS__)
static const int kCutStride = 30;
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
static const int kCutStride = 30;
#else
static const int kCutStride = 3;
#endif
#else
static const int kCutStride = 3;
#endif

void test_a_restart_after_the_claim_never_ends_lost_with_the_broker_reachable_or_not() {
    for (int down = 0; down < 2; down++) {
        int lost = 0;
        int never = 0;
        for (int cut = 102; cut <= 1500; cut += kCutStride) {
            FakeClock clock;
            FakeKv kv;
            Server server;
            FakeFlash flash(4);
            bool connected = false;
            for (int run = 0; run < 2; run++) {
                IdentityStore id(kv);
                const char *why;
                id.setWifi("HomeNet", "password123", &why);
                id.setBroker("mqtt.example", 8883, &why);
                id.setCa(kPem, strlen(kPem), &why);
                DurableCounter counter(flash, 0, 1, 0x544F4F42);
                ClockWall wall(clock, 1767225600);
                Platform platform(clock, server);
                PairingFsm pairing(clock, server, id, wall);
                NetworkController net(clock, id, pairing, platform, counter);
                net.begin();
                int passes = run == 0 ? cut : 6000;
                for (int i = 0; i < passes; i++) {
                    if (run == 0 && i == 100) {
                        server.claimed = true;  // the owner types the code 2 s in
                    }
                    platform.mqtt.allowConnect = !(down && run == 0);
                    platform.sync();
                    net.step(true);
                    clock.advance(20);
                }
                if (run == 1) {
                    connected = net.everConnected();
                    lost += net.bootLost() ? 1 : 0;
                }
            }
            never += connected ? 0 : 1;
        }
        TEST_ASSERT_EQUAL_MESSAGE(0, lost, "a restart after the claim ended Lost");
        TEST_ASSERT_EQUAL_MESSAGE(0, never, "a restart after the claim never connected afterwards");
    }
}

struct CountingSink : public ServerTimeSink {
    int calls = 0;
    int64_t last = 0;
    bool lastSynced = true;
    void onServerTime(int64_t t, bool synced) override {
        calls++;
        last = t;
        lastSynced = synced;
    }
};

// the server's clock: the first answer after the claim carries it, it is asked again every 15 minutes while
// connected and at every reconnect and an older server without the field changes nothing
void test_the_servers_time_is_read_at_pairing_every_15_minutes_and_at_a_reconnect() {
    Rig r;
    CountingSink sink;
    r.pairing.setTimeSink(&sink);
    r.server.autoClaim = true;
    r.server.serverTime = 1795348800;
    r.run(3000);  // 60 s
    TEST_ASSERT_TRUE(r.net.everConnected());
    TEST_ASSERT_TRUE(sink.calls >= 1);
    TEST_ASSERT_EQUAL(1795348800, (int)sink.last);
    int afterPairing = sink.calls;
    r.run(45000);  // 15 minutes more
    TEST_ASSERT_TRUE_MESSAGE(sink.calls > afterPairing, "no time check in 15 minutes");
    int perQuarter = sink.calls;
    r.run(5000);  // 100 s: not again so soon
    TEST_ASSERT_EQUAL(perQuarter, sink.calls);
    r.pairing.requestTimeCheck();  // a reconnect
    r.run(5);
    TEST_ASSERT_EQUAL(perQuarter + 1, sink.calls);
}

void test_a_server_that_sends_no_time_never_calls_the_sink() {
    Rig r;
    CountingSink sink;
    r.pairing.setTimeSink(&sink);
    r.server.autoClaim = true;  // serverTime stays 0: the field is absent
    r.run(60000);
    TEST_ASSERT_TRUE(r.net.everConnected());
    TEST_ASSERT_EQUAL(0, sink.calls);
}

// server_time_synced: true and false are read as they are, null and absent mean the status could not be read: true
void test_the_servers_clock_status_is_read_and_null_or_absent_counts_as_synced() {
    const bool expect[4] = {true, true, false, true};
    for (int field = 0; field < 4; field++) {
        Rig r;
        CountingSink sink;
        r.pairing.setTimeSink(&sink);
        r.server.autoClaim = true;
        r.server.serverTime = 1795348800;
        r.server.syncedField = field;
        r.run(3000);
        TEST_ASSERT_TRUE(sink.calls >= 1);
        TEST_ASSERT_EQUAL_MESSAGE(expect[field] ? 1 : 0, sink.lastSynced ? 1 : 0, "the clock status was read wrongly");
    }
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_pairing_finishes_one_identity_polls_until_paired_then_one_broker_login);
    RUN_TEST(test_the_hourly_identity_cap_survives_restarts);
    RUN_TEST(test_a_restart_while_waiting_and_after_pairing_does_not_ask_for_a_second_identity);
    RUN_TEST(test_a_boot_is_stored_only_when_the_broker_first_accepts_the_hub);
    RUN_TEST(test_a_lost_counter_and_an_out_of_range_boot_stop_publication_with_a_plain_reason);
    RUN_TEST(test_a_null_last_boot_means_a_new_device_and_the_hub_connects);
    RUN_TEST(test_two_refused_logins_after_the_claim_mean_pair_again);
    RUN_TEST(test_unclaim_removes_the_claim_and_the_hub_pairs_again);
    RUN_TEST(test_the_stored_settings_are_read_once_a_second_not_every_pass);
    RUN_TEST(test_a_restart_at_every_step_of_pairing_still_ends_connected);
    RUN_TEST(test_a_restart_after_the_claim_never_ends_lost_with_the_broker_reachable_or_not);
    RUN_TEST(test_the_servers_time_is_read_at_pairing_every_15_minutes_and_at_a_reconnect);
    RUN_TEST(test_a_server_that_sends_no_time_never_calls_the_sink);
    RUN_TEST(test_the_servers_clock_status_is_read_and_null_or_absent_counts_as_synced);
    return UNITY_END();
}
