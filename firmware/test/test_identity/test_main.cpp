#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>

#include "../support/fakes.h"
#include "identity.h"
#include "pairing.h"
#include "provision.h"
#include "tlscheck.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static std::string pemText() {
    return "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MDAKBggqhkjOPQQD\nAjAXMRUwEwYDVQQDDAxUZXN0IFJvb3QgQ0EwHhcNMjYwMTAxMDAwMDAwWhcNMzYw\n-----END CERTIFICATE-----\n";
}

static std::string base64(const std::string &in) {
    static const char *t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    size_t i = 0;
    while (i + 2 < in.size()) {
        uint32_t v = ((uint8_t)in[i] << 16) | ((uint8_t)in[i + 1] << 8) | (uint8_t)in[i + 2];
        out += t[v >> 18];
        out += t[(v >> 12) & 63];
        out += t[(v >> 6) & 63];
        out += t[v & 63];
        i += 3;
    }
    if (in.size() - i == 1) {
        uint32_t v = (uint8_t)in[i] << 16;
        out += t[v >> 18];
        out += t[(v >> 12) & 63];
        out += "==";
    } else if (in.size() - i == 2) {
        uint32_t v = ((uint8_t)in[i] << 16) | ((uint8_t)in[i + 1] << 8);
        out += t[v >> 18];
        out += t[(v >> 12) & 63];
        out += t[(v >> 6) & 63];
        out += '=';
    }
    return out;
}

static bool cmd(IdentityStore &s, const std::string &line, std::string *reply = nullptr) {
    static char r[300];
    bool ok = handleProvisionCommand(s, line.data(), line.size(), r, sizeof r);
    if (reply) {
        *reply = r;
    }
    return ok;
}

void test_base64_round_trips_and_refuses_junk() {
    for (std::string s : {"", "a", "ab", "abc", "abcd", "hello world!"}) {
        uint8_t out[64];
        std::string enc = base64(s);
        if (s.empty()) {
            continue;
        }
        size_t n = base64Decode(enc.data(), enc.size(), out, sizeof out);
        TEST_ASSERT_EQUAL((int)s.size(), (int)n);
        TEST_ASSERT_EQUAL_MEMORY(s.data(), out, n);
    }
    uint8_t out[8];
    TEST_ASSERT_EQUAL(0, (int)base64Decode("ab$d", 4, out, sizeof out));
    TEST_ASSERT_EQUAL(0, (int)base64Decode("YQ==YQ==", 8, out, sizeof out));  // data after padding
    TEST_ASSERT_EQUAL(0, (int)base64Decode("YWJjZGVmZ2hpams=", 16, out, 4));  // does not fit
}

void test_provisioning_stores_and_reads_back_everything() {
    FakeKv kv;
    IdentityStore s(kv);
    TEST_ASSERT_TRUE(cmd(s, "wifi HomeNet correct-horse"));
    TEST_ASSERT_TRUE(cmd(s, "broker mqtt.home.example 8883"));
    TEST_ASSERT_TRUE(cmd(s, "device hub-k7qm2xpd abcdefghij0123"));
    TEST_ASSERT_TRUE(cmd(s, "ca " + base64(pemText())));
    TEST_ASSERT_TRUE(s.readyForTls());
    char ssid[40], pass[70], host[70], id[70], sec[70];
    static char pem[3100];
    uint16_t port;
    TEST_ASSERT_TRUE(s.wifi(ssid, sizeof ssid, pass, sizeof pass));
    TEST_ASSERT_EQUAL_STRING("HomeNet", ssid);
    TEST_ASSERT_EQUAL_STRING("correct-horse", pass);
    TEST_ASSERT_TRUE(s.broker(host, sizeof host, port));
    TEST_ASSERT_EQUAL(8883, port);
    TEST_ASSERT_TRUE(s.device(id, sizeof id, sec, sizeof sec));
    TEST_ASSERT_EQUAL_STRING("abcdefghij0123", sec);
    TEST_ASSERT_TRUE(s.ca(pem, sizeof pem) > 0);
    TEST_ASSERT_EQUAL_STRING(pemText().c_str(), pem);
}

void test_every_field_is_validated_on_the_way_in() {
    FakeKv kv;
    IdentityStore s(kv);
    std::string reply;
    TEST_ASSERT_FALSE(cmd(s, "wifi " + std::string(33, 'a') + " longenoughpassword"));
    TEST_ASSERT_FALSE(cmd(s, "wifi Net short7!"));  // 7 characters
    TEST_ASSERT_FALSE(cmd(s, "wifi"));
    TEST_ASSERT_TRUE(cmd(s, "wifi OpenNet"));       // an open network has no password
    TEST_ASSERT_FALSE(cmd(s, "broker host.example 0"));
    TEST_ASSERT_FALSE(cmd(s, "broker host.example 65536"));
    TEST_ASSERT_FALSE(cmd(s, "broker host.example 12ab"));
    TEST_ASSERT_FALSE(cmd(s, "broker bad_host!.example 8883"));
    TEST_ASSERT_TRUE(cmd(s, "broker onlyhost"));  // the port defaults to the TLS port 8883
    TEST_ASSERT_FALSE(cmd(s, "broker"));
    TEST_ASSERT_FALSE(cmd(s, "device Hub-1 abcdefghij"));  // upper case
    TEST_ASSERT_FALSE(cmd(s, "device hub-1 short"));
    TEST_ASSERT_FALSE(cmd(s, "device -hub abcdefghij"));
    TEST_ASSERT_FALSE(cmd(s, "ca !!!notbase64"));
    TEST_ASSERT_FALSE(cmd(s, "ca " + base64("not a certificate at all, just some text that is long enough to pass a length check")));
    TEST_ASSERT_FALSE(cmd(s, "frobnicate"));
    TEST_ASSERT_FALSE(cmd(s, std::string("wifi a\tb")));  // a control character
    TEST_ASSERT_FALSE(cmd(s, std::string(5000, 'x')));
    TEST_ASSERT_FALSE(cmd(s, "clear nothing"));
    TEST_ASSERT_TRUE(strstr(((void)cmd(s, "broker host.example 0", &reply), reply.c_str()), "port") != nullptr);
    // nothing bad was stored
    TEST_ASSERT_EQUAL_STRING("onlyhost", kv.data["broker_host"].c_str());  // the bad ones changed nothing
    TEST_ASSERT_TRUE(kv.data.find("dev_id") == kv.data.end());
    kv.failPut = true;
    TEST_ASSERT_FALSE(cmd(s, "broker host.example 8883"));  // a failing flash is reported
}

void test_a_wifi_name_and_password_with_spaces_and_an_open_network() {
    FakeKv kv;
    IdentityStore s(kv);
    TEST_ASSERT_TRUE(cmd(s, "wifi \"Home Net 5G\" \"a long pass phrase\""));
    char ssid[40], pass[70];
    TEST_ASSERT_TRUE(s.wifi(ssid, sizeof ssid, pass, sizeof pass));
    TEST_ASSERT_EQUAL_STRING("Home Net 5G", ssid);
    TEST_ASSERT_EQUAL_STRING("a long pass phrase", pass);
    TEST_ASSERT_TRUE(cmd(s, "wifi \"Cafe Open\""));  // an open network: no empty value is stored
    TEST_ASSERT_TRUE(kv.data.find("wifi_pass") == kv.data.end());
    TEST_ASSERT_TRUE(s.wifi(ssid, sizeof ssid, pass, sizeof pass));
    TEST_ASSERT_EQUAL_STRING("", pass);
    TEST_ASSERT_FALSE(cmd(s, "wifi \"unterminated"));  // a quote that never closes is refused, not guessed
}

void test_show_never_prints_a_secret() {
    FakeKv kv;
    IdentityStore s(kv);
    cmd(s, "wifi HomeNet correct-horse");
    cmd(s, "device hub-k7qm2xpd mysecretvalue1");
    std::string reply;
    TEST_ASSERT_TRUE(cmd(s, "show", &reply));
    TEST_ASSERT_NULL(strstr(reply.c_str(), "correct-horse"));
    TEST_ASSERT_NULL(strstr(reply.c_str(), "mysecretvalue1"));
    TEST_ASSERT_NULL(strstr(reply.c_str(), "k7qm2xpd"));
    TEST_ASSERT_NOT_NULL(strstr(reply.c_str(), "\"wifi\":true"));
    TEST_ASSERT_NOT_NULL(strstr(reply.c_str(), "\"ca\":false"));
}

void test_factory_reset_clears_what_it_says_it_clears() {
    FakeKv kv;
    IdentityStore s(kv);
    cmd(s, "wifi HomeNet correct-horse");
    cmd(s, "broker mqtt.home.example 8883");
    cmd(s, "device hub-k7qm2xpd abcdefghij0123");
    cmd(s, "ca " + base64(pemText()));
    cmd(s, "insecure on");
    TEST_ASSERT_TRUE(cmd(s, "clear device"));
    char id[70], sec[70];
    TEST_ASSERT_FALSE(s.device(id, sizeof id, sec, sizeof sec));
    char ssid[40], pass[70];
    TEST_ASSERT_TRUE(s.wifi(ssid, sizeof ssid, pass, sizeof pass));  // the network stays
    TEST_ASSERT_FALSE(s.readyForTls());
    TEST_ASSERT_TRUE(cmd(s, "clear all"));
    TEST_ASSERT_EQUAL(0, (int)kv.data.size());  // not one key is left behind, whatever was added
    TEST_ASSERT_FALSE(s.insecure());
}

void test_insecure_is_a_separate_explicit_flag_and_not_enough_to_get_ready_alone() {
    FakeKv kv;
    IdentityStore s(kv);
    cmd(s, "wifi HomeNet correct-horse");
    cmd(s, "broker mqtt.home.example 1883");
    cmd(s, "device hub-k7qm2xpd abcdefghij0123");
    TEST_ASSERT_FALSE(s.readyForTls());       // no CA, so TLS is not possible
    TEST_ASSERT_FALSE(s.readyInsecure());     // and plain is not allowed until it is asked for
    TEST_ASSERT_TRUE(cmd(s, "insecure on"));
    TEST_ASSERT_TRUE(s.readyInsecure());
    TEST_ASSERT_TRUE(cmd(s, "insecure off"));
    TEST_ASSERT_FALSE(s.readyInsecure());
    TEST_ASSERT_FALSE(cmd(s, "insecure maybe"));
}

// ----- pairing -----

static const char *kIdentityWhy = "";
static const char *kIdentity =
    "{\"device_id\":\"hub-k7qm2xpd\",\"device_secret\":\"s3cr3t-value-0123456789\",\"code\":\"K7QM-2XPD\",\"expires_in\":600}";

struct PairRig {
    FakeClock clock;
    FakeHttps http;
    FakeKv kv;
    IdentityStore store{kv};
    ClockWall wall{clock, 1767225600};
    PairingFsm fsm{clock, http, store, wall};
    PairRig() { http.identityReplies = {FakeHttps::reply(201, kIdentity)}; }
    void run(uint32_t ms) {
        for (uint32_t i = 0; i < ms; i += 100) {
            clock.advance(100);
            fsm.tick();
        }
    }
};

void test_pairing_happy_path_polls_every_three_seconds_and_stops_when_paired() {
    PairRig r;
    r.http.deviceReplies = {FakeHttps::reply(200, "{\"device_id\":\"hub-k7qm2xpd\",\"paired\":false}")};
    r.fsm.begin();
    r.run(100);
    TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Waiting);
    TEST_ASSERT_EQUAL_STRING("K7QM-2XPD", r.fsm.code());
    char id[70], sec[70];
    TEST_ASSERT_TRUE(r.store.device(id, sizeof id, sec, sizeof sec));  // written at once
    TEST_ASSERT_EQUAL_STRING("hub-k7qm2xpd", id);
    r.run(30000);
    TEST_ASSERT_TRUE(r.http.deviceCalls >= 9 && r.http.deviceCalls <= 10);  // every 3 s, not faster
    TEST_ASSERT_EQUAL_STRING("hub-k7qm2xpd", r.http.lastId.c_str());
    r.http.deviceReplies = {FakeHttps::reply(200, "{\"device_id\":\"hub-k7qm2xpd\",\"paired\":true}")};
    r.run(3100);
    TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Paired);
    int calls = r.http.deviceCalls;
    r.run(60000);
    TEST_ASSERT_EQUAL(calls, r.http.deviceCalls);  // paired: it never calls again from here
    TEST_ASSERT_EQUAL(1, r.http.identityCalls);
}

void test_an_unclaimed_identity_expires_and_a_new_one_is_requested() {
    PairRig r;
    r.http.deviceReplies = {FakeHttps::reply(200, "{\"paired\":false}")};
    r.fsm.begin();
    r.run(100);
    r.run(599000);
    TEST_ASSERT_EQUAL(1, r.http.identityCalls);
    r.run(2000);
    TEST_ASSERT_TRUE(r.http.identityCalls >= 2);  // after expires_in seconds, a new request
}

void test_a_429_is_obeyed_and_the_hourly_cap_holds() {
    PairRig r;
    r.http.identityReplies = {FakeHttps::reply(429, "{}", 120)};
    r.fsm.begin();
    r.run(100);
    TEST_ASSERT_EQUAL(1, r.http.identityCalls);
    r.run(119000);
    TEST_ASSERT_EQUAL(1, r.http.identityCalls);  // Retry-After honoured
    r.run(2000);
    TEST_ASSERT_EQUAL(2, r.http.identityCalls);
    PairRig q;
    q.http.identityReplies = {FakeHttps::reply(500, "")};  // a broken server answers every time
    q.fsm.begin();
    q.run(3600000 - 100);
    TEST_ASSERT_TRUE(q.http.identityCalls <= 20);  // never more than 20 requests in an hour
}

void test_a_reply_the_hub_cannot_trust_is_never_stored() {
    const char *bad[] = {
        "{\"device_id\":\"Hub_1\",\"device_secret\":\"s3cr3t-value-0123\",\"code\":\"K7QM-2XPD\",\"expires_in\":600}",
        "{\"device_id\":\"hub-1\",\"device_secret\":\"short\",\"code\":\"K7QM-2XPD\",\"expires_in\":600}",
        "{\"device_id\":\"hub-1\",\"device_secret\":\"s3cr3t-value-0123\",\"code\":\"bad code!\",\"expires_in\":600}",
        "{\"device_id\":\"hub-1\",\"device_secret\":\"s3cr3t-value-0123\",\"code\":\"K7QM-2XPD\",\"expires_in\":0}",
        "{\"device_id\":\"hub-1\",\"device_secret\":\"s3cr3t-value-0123\",\"code\":\"K7QM-2XPD\",\"expires_in\":99999}",
        "{\"device_id\":\"hub-1\"}",
        "not json",
        ""};
    for (const char *body : bad) {
        PairRig r;
        r.http.identityReplies = {FakeHttps::reply(201, body)};
        r.fsm.begin();
        r.run(500);
        char id[70], sec[70];
        TEST_ASSERT_FALSE_MESSAGE(r.store.device(id, sizeof id, sec, sizeof sec), body);
        TEST_ASSERT_FALSE(r.fsm.state() == PairingFsm::State::Waiting);
    }
    PairRig w;
    w.http.identityReplies = {FakeHttps::reply(200, kIdentity)};  // a 200 is not the 201 the flow expects
    w.fsm.begin();
    w.run(500);
    TEST_ASSERT_FALSE(w.fsm.state() == PairingFsm::State::Waiting);
}

void test_a_401_forgets_the_identity_and_pairs_again() {
    PairRig r;
    r.http.deviceReplies = {FakeHttps::reply(401, "{}")};
    r.fsm.begin();
    r.run(100);
    r.run(3100);
    TEST_ASSERT_TRUE(r.http.identityCalls >= 2);  // the old identity was dropped and a new one asked for
    PairRig p;
    p.fsm.begin();
    p.http.deviceReplies = {FakeHttps::reply(200, "{\"paired\":true}")};
    p.run(3500);
    TEST_ASSERT_TRUE(p.fsm.state() == PairingFsm::State::Paired);
    p.fsm.onUnauthorised();  // a later call said 401: the owner removed this hub
    char id[70], sec[70];
    TEST_ASSERT_FALSE(p.store.device(id, sizeof id, sec, sizeof sec));
    p.run(200);
    TEST_ASSERT_TRUE(p.http.identityCalls >= 2);
}

// ----- certificate dates -----

void test_the_hub_does_not_count_as_paired_until_the_server_says_so_and_names_who_claimed_it() {
    PairRig r;
    r.http.deviceReplies = {FakeHttps::reply(200, "{\"paired\":false}")};
    r.fsm.begin();
    r.run(10000);
    TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Waiting);  // the broker is not to be tried yet
    TEST_ASSERT_FALSE(r.store.paired());
    r.http.deviceReplies = {FakeHttps::reply(
        200, "{\"device_id\":\"hub-k7qm2xpd\",\"paired\":true,\"claimed_by\":\"j***@e***.com\",\"undo_until\":\"2026-11-22T12:15:00Z\"}")};
    r.run(3100);
    TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Paired);
    TEST_ASSERT_TRUE(r.store.paired());
    TEST_ASSERT_EQUAL_STRING("j***@e***.com", r.fsm.claimedBy());
    TEST_ASSERT_EQUAL_STRING("2026-11-22T12:15:00Z", r.fsm.undoUntil());
}

void test_a_restart_carries_on_from_what_storage_says() {
    {
        PairRig r;  // nothing stored
        r.fsm.begin();
        TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::NeedsPairing);
    }
    {
        PairRig r;  // an identity that was not yet paired: keep polling and show the code again
        r.store.setDevice("hub-k7qm2xpd", "s3cr3t-value-0123456789", &kIdentityWhy);
        r.store.setPairingCode("K7QM-2XPD");
        r.fsm.begin();
        TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Waiting);
        TEST_ASSERT_EQUAL_STRING("K7QM-2XPD", r.fsm.code());
        TEST_ASSERT_EQUAL(0, r.http.identityCalls);  // it did not ask for a second identity
    }
    {
        PairRig r;  // an identity that was paired: straight to the broker
        r.store.setDevice("hub-k7qm2xpd", "s3cr3t-value-0123456789", &kIdentityWhy);
        r.store.setPaired(true);
        r.fsm.begin();
        TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Paired);
    }
}

void test_a_wrong_claim_can_be_undone_and_the_hub_pairs_again() {
    PairRig r;
    r.http.deviceReplies = {FakeHttps::reply(200, "{\"paired\":true,\"claimed_by\":\"x***@y***.com\"}")};
    r.fsm.begin();
    r.run(3500);
    TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Paired);
    r.http.removeReplies = {FakeHttps::reply(500, "")};
    TEST_ASSERT_FALSE(r.fsm.unclaim());  // the server refused: nothing is forgotten
    char id[70], sec[70];
    TEST_ASSERT_TRUE(r.store.device(id, sizeof id, sec, sizeof sec));
    TEST_ASSERT_TRUE(r.fsm.state() == PairingFsm::State::Paired);
    r.http.removeReplies = {FakeHttps::reply(200, "{}")};
    TEST_ASSERT_TRUE(r.fsm.unclaim());
    TEST_ASSERT_EQUAL_STRING("hub-k7qm2xpd", r.http.lastRemoveId.c_str());
    TEST_ASSERT_EQUAL_STRING("s3cr3t-value-0123456789", r.http.lastRemoveSecret.c_str());
    TEST_ASSERT_FALSE(r.store.device(id, sizeof id, sec, sizeof sec));
    TEST_ASSERT_FALSE(r.store.paired());
    TEST_ASSERT_EQUAL_STRING("", r.fsm.claimedBy());
    r.run(200);
    TEST_ASSERT_TRUE(r.http.identityCalls >= 2);  // a new identity: it is a new device
}

void test_the_broker_defaults_to_the_tls_port_and_a_tls_hub_refuses_the_plain_one() {
    FakeKv kv;
    IdentityStore s(kv);
    std::string reply;
    TEST_ASSERT_TRUE(cmd(s, "wifi HomeNet correct-horse"));
    TEST_ASSERT_TRUE(cmd(s, "broker mqtt.home.example"));
    char host[70];
    uint16_t port = 0;
    TEST_ASSERT_TRUE(s.broker(host, sizeof host, port));
    TEST_ASSERT_EQUAL(8883, port);
    cmd(s, "device hub-k7qm2xpd abcdefghij0123");
    cmd(s, "ca " + base64(pemText()));
    TEST_ASSERT_TRUE(s.readyForTls());
    cmd(s, "broker mqtt.home.example 1883");
    TEST_ASSERT_FALSE(s.readyForTls());  // never TLS to the development listener
}

void test_the_supply_rating_is_a_validated_setting_with_a_safe_default() {
    FakeKv kv;
    IdentityStore s(kv);
    TEST_ASSERT_EQUAL(5000, s.supplyMa());  // unset: the board's own 5 A supply
    TEST_ASSERT_TRUE(cmd(s, "supply 3000"));
    TEST_ASSERT_EQUAL(3000, s.supplyMa());
    TEST_ASSERT_FALSE(cmd(s, "supply 2000"));   // below what the board needs
    TEST_ASSERT_FALSE(cmd(s, "supply 9000"));
    TEST_ASSERT_FALSE(cmd(s, "supply abc"));
    TEST_ASSERT_FALSE(cmd(s, "supply"));
    TEST_ASSERT_EQUAL(3000, s.supplyMa());       // the bad ones changed nothing
    kv.data["supply_ma"] = "17";                  // a damaged stored value falls back to the safe figure
    TEST_ASSERT_EQUAL(5000, s.supplyMa());
    cmd(s, "clear all");
    TEST_ASSERT_EQUAL(5000, s.supplyMa());
}

void test_cert_epoch_known_values() {
    TEST_ASSERT_EQUAL(0, (int)certEpoch(CertTime{1970, 1, 1, 0, 0, 0}));
    TEST_ASSERT_EQUAL(1767225600, (int)certEpoch(CertTime{2026, 1, 1, 0, 0, 0}));
    TEST_ASSERT_EQUAL(1835481599LL, certEpoch(CertTime{2028, 2, 29, 23, 59, 59}));
    TEST_ASSERT_EQUAL(4102444799LL, certEpoch(CertTime{2099, 12, 31, 23, 59, 59}));
    TEST_ASSERT_EQUAL(-1, (int)certEpoch(CertTime{2026, 13, 1, 0, 0, 0}));
    TEST_ASSERT_EQUAL(-1, (int)certEpoch(CertTime{2026, 2, 29, 0, 0, 0}));  // not a leap year
    TEST_ASSERT_EQUAL(-1, (int)certEpoch(CertTime{2026, 4, 31, 0, 0, 0}));
    TEST_ASSERT_EQUAL(-1, (int)certEpoch(CertTime{2026, 1, 1, 24, 0, 0}));
}

void test_validity_boundaries_clock_and_chain() {
    CertValidity v{CertTime{2026, 1, 1, 0, 0, 0}, CertTime{2027, 1, 1, 0, 0, 0}};
    int64_t from = certEpoch(v.notBefore), to = certEpoch(v.notAfter);
    TEST_ASSERT_TRUE(checkValidity(v, from) == CertCheck::Ok);
    TEST_ASSERT_TRUE(checkValidity(v, from - 1) == CertCheck::NotYetValid);
    TEST_ASSERT_TRUE(checkValidity(v, to) == CertCheck::Ok);
    TEST_ASSERT_TRUE(checkValidity(v, to + 1) == CertCheck::Expired);
    TEST_ASSERT_TRUE(checkValidity(v, 0) == CertCheck::NoClock);   // an unset clock never passes
    TEST_ASSERT_TRUE(checkValidity(v, -5) == CertCheck::NoClock);
    CertValidity backwards{CertTime{2027, 1, 1, 0, 0, 0}, CertTime{2026, 1, 1, 0, 0, 0}};
    TEST_ASSERT_TRUE(checkValidity(backwards, from + 5) == CertCheck::Malformed);
    CertValidity expired{CertTime{2020, 1, 1, 0, 0, 0}, CertTime{2021, 1, 1, 0, 0, 0}};
    CertValidity chain[3] = {v, expired, v};  // the leaf is fine, an intermediate is not
    TEST_ASSERT_TRUE(checkChain(chain, 3, from + 100) == CertCheck::Expired);
    TEST_ASSERT_TRUE(checkChain(chain, 1, from + 100) == CertCheck::Ok);
    TEST_ASSERT_TRUE(checkChain(chain, 0, from + 100) == CertCheck::Malformed);
    TEST_ASSERT_TRUE(checkChain(nullptr, 2, from + 100) == CertCheck::Malformed);
    CertValidity many[11] = {v, v, v, v, v, v, v, v, v, v, v};
    TEST_ASSERT_TRUE(checkChain(many, 10, from + 100) == CertCheck::Ok);        // ten are dated, every one
    TEST_ASSERT_TRUE(checkChain(many, 11, from + 100) == CertCheck::Malformed);  // eleven are refused, not cut to ten
    many[9] = expired;
    TEST_ASSERT_TRUE(checkChain(many, 10, from + 100) == CertCheck::Expired);   // the tenth is checked too
    TEST_ASSERT_NOT_NULL(strstr(certCheckText(CertCheck::NoClock), "clock"));
}

void test_clearing_everything_also_forgets_the_accepted_bluetooth_devices() {
    FakeKv kv;
    IdentityStore id(kv);
    TEST_ASSERT_TRUE(kv.put("ble_ok", "C00000000001/0", 14));
    id.clearAll();
    char out[40];
    size_t n = 0;
    TEST_ASSERT_FALSE(kv.get("ble_ok", out, sizeof out, n));  // a factory reset leaves no trusted phone behind
}

void test_sound_is_off_by_default_turns_on_when_stored_and_a_factory_reset_turns_it_off() {
    FakeKv kv;
    IdentityStore id(kv);
    TEST_ASSERT_FALSE(id.soundOn());
    TEST_ASSERT_TRUE(id.setSoundOn(true));
    TEST_ASSERT_TRUE(id.soundOn());
    IdentityStore again(kv);  // a restart
    TEST_ASSERT_TRUE(again.soundOn());
    id.clearAll();
    TEST_ASSERT_FALSE(IdentityStore(kv).soundOn());
    TEST_ASSERT_TRUE(id.setSoundOn(true));
    TEST_ASSERT_TRUE(id.setSoundOn(false));
    TEST_ASSERT_FALSE(id.soundOn());
}

void test_a_sound_setting_that_could_not_be_written_reports_failure() {
    FakeKv kv;
    IdentityStore id(kv);
    kv.failPut = true;
    TEST_ASSERT_FALSE(id.setSoundOn(true));  // the write failed: the caller must not turn sound on
    TEST_ASSERT_FALSE(id.soundOn());
    kv.failPut = false;
    TEST_ASSERT_TRUE(id.setSoundOn(true));
    TEST_ASSERT_TRUE(id.soundOn());
}

// the third output's length in use: default, refused above the maximum, refused when the write fails
void test_the_third_outputs_length_is_stored_refused_over_the_maximum_and_refused_when_the_write_fails() {
    FakeKv kv;
    IdentityStore id(kv);
    const char *why = "";
    TEST_ASSERT_EQUAL(60, (int)id.auxLength(150, 60));  // nothing stored: the default
    TEST_ASSERT_TRUE(id.setAuxLength(100, 150, &why));
    TEST_ASSERT_EQUAL(100, (int)id.auxLength(150, 60));
    TEST_ASSERT_TRUE(id.setAuxLength(150, 150, &why));  // the maximum itself is allowed
    TEST_ASSERT_FALSE(id.setAuxLength(151, 150, &why));  // over it is refused
    TEST_ASSERT_NOT_NULL(strstr(why, "longest"));
    TEST_ASSERT_EQUAL(150, (int)id.auxLength(150, 60));  // and nothing changed
    kv.failPut = true;
    TEST_ASSERT_FALSE(id.setAuxLength(80, 150, &why));  // a failed write is refused
    TEST_ASSERT_NOT_NULL(strstr(why, "could not be saved"));
    kv.failPut = false;
    TEST_ASSERT_EQUAL(150, (int)id.auxLength(150, 60));
    // a stored figure over the maximum (a smaller maximum in a later build) is not used
    kv.put("aux_len", "400", 3);
    TEST_ASSERT_EQUAL(60, (int)id.auxLength(150, 60));
    kv.put("aux_len", "x9", 2);
    TEST_ASSERT_EQUAL(60, (int)id.auxLength(150, 60));
    id.clearAll();
    TEST_ASSERT_EQUAL(60, (int)id.auxLength(150, 60));  // a factory reset goes back to the default
}

// serial arguments are parsed strictly: digits only, the whole argument, range checked before any cast
void test_serial_numbers_are_parsed_strictly() {
    uint32_t v = 777;
    for (const char *bad : {"abc", "12abc", "-1", "+5", " 5", "5 ", "", "0x10", "1e2", "65596", "151", "99999999999", "4294967296"}) {
        v = 777;
        TEST_ASSERT_FALSE_MESSAGE(parseUnsigned(bad, 150, v), bad);
        TEST_ASSERT_EQUAL(777, (int)v);  // left alone when refused
    }
    TEST_ASSERT_TRUE(parseUnsigned("0", 150, v));
    TEST_ASSERT_EQUAL(0, (int)v);
    TEST_ASSERT_TRUE(parseUnsigned("60", 150, v));
    TEST_ASSERT_EQUAL(60, (int)v);
    TEST_ASSERT_TRUE(parseUnsigned("150", 150, v));
    TEST_ASSERT_EQUAL(150, (int)v);
    TEST_ASSERT_FALSE(parseUnsigned(nullptr, 150, v));
    // the board's unsigned long is 32 bits: numbers that wrap there must be refused here too. The template is run at
    // 32 bits and at 16 bits as a harsher case, so the host sees what the board sees whatever its own long is
    uint32_t w = 777;
    for (const char *wraps : {"4294967356", "4294967376", "4294972296", "4294967296", "99999999999", "10000000060"}) {
        TEST_ASSERT_FALSE_MESSAGE(parseUnsignedIn<uint32_t>(wraps, 0xFFFFFFFFu, w), wraps);
        TEST_ASSERT_FALSE_MESSAGE(parseUnsigned(wraps, 100000, w), wraps);
    }
    TEST_ASSERT_TRUE(parseUnsignedIn<uint32_t>("4294967295", 0xFFFFFFFFu, w));
    TEST_ASSERT_EQUAL_UINT32(4294967295u, w);
    uint16_t h = 7;
    TEST_ASSERT_FALSE(parseUnsignedIn<uint16_t>("65596", 65535, h));
    TEST_ASSERT_TRUE(parseUnsignedIn<uint16_t>("65535", 65535, h));
    TEST_ASSERT_EQUAL(65535, h);
}

void test_provision_numbers_are_refused_unless_they_are_whole_numbers_in_range() {
    FakeKv kv;
    IdentityStore id(kv);
    char reply[200];
    for (const char *line : {"broker mqtt.example 12abc", "broker mqtt.example +5", "broker mqtt.example 0", "broker mqtt.example 70000",
                             "api example.org 44x", "supply 30abc", "supply -3000", "supply 99999999999"}) {
        char msg[100];
        snprintf(msg, sizeof msg, "accepted: %s", line);
        TEST_ASSERT_FALSE_MESSAGE(handleProvisionCommand(id, line, strlen(line), reply, sizeof reply), msg);
    }
    const char *good = "broker mqtt.example 8883";
    TEST_ASSERT_TRUE(handleProvisionCommand(id, good, strlen(good), reply, sizeof reply));
}

// a write that lands but cannot be read back: say what is true, not that nothing changed
void test_an_aux_length_that_cannot_be_read_back_says_the_stored_value_is_unconfirmed() {
    struct LyingKv : public FakeKv {
        bool get(const char *key, char *out, size_t cap, size_t &length) override {
            if (!strcmp(key, "aux_len") && lie) {
                length = 0;
                return false;
            }
            return FakeKv::get(key, out, cap, length);
        }
        bool lie = false;
    } kv;
    IdentityStore id(kv);
    const char *why = "";
    kv.lie = true;
    TEST_ASSERT_FALSE(id.setAuxLength(90, 150, &why));
    TEST_ASSERT_NOT_NULL(strstr(why, "could not be read back"));
    TEST_ASSERT_NOT_NULL(strstr(why, "in use now is unchanged"));
    TEST_ASSERT_NOT_NULL(strstr(why, "could not be confirmed"));
    TEST_ASSERT_NULL(strstr(why, "so it is unchanged"));
    TEST_ASSERT_EQUAL_STRING("90", kv.data["aux_len"].c_str());  // the write did land
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_clearing_everything_also_forgets_the_accepted_bluetooth_devices);
    RUN_TEST(test_sound_is_off_by_default_turns_on_when_stored_and_a_factory_reset_turns_it_off);
    RUN_TEST(test_a_sound_setting_that_could_not_be_written_reports_failure);
    RUN_TEST(test_serial_numbers_are_parsed_strictly);
    RUN_TEST(test_provision_numbers_are_refused_unless_they_are_whole_numbers_in_range);
    RUN_TEST(test_an_aux_length_that_cannot_be_read_back_says_the_stored_value_is_unconfirmed);
    RUN_TEST(test_the_third_outputs_length_is_stored_refused_over_the_maximum_and_refused_when_the_write_fails);
    RUN_TEST(test_base64_round_trips_and_refuses_junk);
    RUN_TEST(test_provisioning_stores_and_reads_back_everything);
    RUN_TEST(test_every_field_is_validated_on_the_way_in);
    RUN_TEST(test_a_wifi_name_and_password_with_spaces_and_an_open_network);
    RUN_TEST(test_show_never_prints_a_secret);
    RUN_TEST(test_factory_reset_clears_what_it_says_it_clears);
    RUN_TEST(test_insecure_is_a_separate_explicit_flag_and_not_enough_to_get_ready_alone);
    RUN_TEST(test_pairing_happy_path_polls_every_three_seconds_and_stops_when_paired);
    RUN_TEST(test_an_unclaimed_identity_expires_and_a_new_one_is_requested);
    RUN_TEST(test_a_429_is_obeyed_and_the_hourly_cap_holds);
    RUN_TEST(test_a_reply_the_hub_cannot_trust_is_never_stored);
    RUN_TEST(test_a_401_forgets_the_identity_and_pairs_again);
    RUN_TEST(test_the_hub_does_not_count_as_paired_until_the_server_says_so_and_names_who_claimed_it);
    RUN_TEST(test_a_restart_carries_on_from_what_storage_says);
    RUN_TEST(test_a_wrong_claim_can_be_undone_and_the_hub_pairs_again);
    RUN_TEST(test_the_broker_defaults_to_the_tls_port_and_a_tls_hub_refuses_the_plain_one);
    RUN_TEST(test_the_supply_rating_is_a_validated_setting_with_a_safe_default);
    RUN_TEST(test_cert_epoch_known_values);
    RUN_TEST(test_validity_boundaries_clock_and_chain);
    return UNITY_END();
}
