#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "../support/fakes.h"
#include "identity.h"
#include "mqttwire.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static MqttWireConfig config() {
    return MqttWireConfig{"broker.example", 8883, "hub-abc", "hub-abc", "s3cretpass", 30};
}

void test_connect_packet_is_exactly_the_mqtt_311_layout() {
    uint8_t out[128];
    size_t n = buildConnect(out, sizeof out, config());
    const uint8_t want[] = {0x10, 0x28, 0x00, 0x04, 'M', 'Q', 'T', 'T', 0x04, 0xC2, 0x00, 0x1E, 0x00, 0x07, 'h', 'u', 'b', '-', 'a', 'b', 'c',
                            0x00, 0x07, 'h', 'u', 'b', '-', 'a', 'b', 'c', 0x00, 0x0A, 's', '3', 'c', 'r', 'e', 't', 'p', 'a', 's', 's'};
    TEST_ASSERT_EQUAL(sizeof want, n);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out, n);
    MqttWireConfig bad = config();
    bad.clientId = "";
    TEST_ASSERT_EQUAL(0, (int)buildConnect(out, sizeof out, bad));
    TEST_ASSERT_EQUAL(0, (int)buildConnect(out, 10, config()));  // buffer too small
}

void test_publish_packets_at_both_qos_and_long_lengths() {
    uint8_t out[300];
    const uint8_t body[3] = {1, 2, 3};
    size_t n = buildPublish(out, sizeof out, "a/b", body, 3, false, 0, false);
    const uint8_t q0[] = {0x30, 0x08, 0x00, 0x03, 'a', '/', 'b', 1, 2, 3};
    TEST_ASSERT_EQUAL(sizeof q0, n);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(q0, out, n);
    n = buildPublish(out, sizeof out, "a/b", body, 3, true, 0x1234, false);
    const uint8_t q1[] = {0x32, 0x0A, 0x00, 0x03, 'a', '/', 'b', 0x12, 0x34, 1, 2, 3};
    TEST_ASSERT_EQUAL(sizeof q1, n);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(q1, out, n);
    TEST_ASSERT_EQUAL(0x3A, out[0] | 0x08);  // the dup flag is bit 3
    std::vector<uint8_t> big(20000, 7);
    std::vector<uint8_t> packet(20100);
    n = buildPublish(packet.data(), packet.size(), "t", big.data(), big.size(), true, 5, false);
    TEST_ASSERT_EQUAL(1 + 3 + 2 + 1 + 2 + 20000, (int)n);  // the length takes three bytes
    TEST_ASSERT_EQUAL(0x32, packet[0]);
    TEST_ASSERT_EQUAL(0xA5, packet[1]);  // 20005 = 37 + 28 x 128 + 1 x 16384, low group first
    TEST_ASSERT_EQUAL(0x9C, packet[2]);
    TEST_ASSERT_EQUAL(0x01, packet[3]);
}

void test_publish_never_sets_the_retain_flag_and_the_client_id_is_the_device_id() {
    uint8_t out[64];
    const uint8_t body[1] = {1};
    for (bool qos1 : {false, true}) {
        buildPublish(out, sizeof out, "t", body, 1, qos1, 1, false);
        TEST_ASSERT_EQUAL(0, out[0] & 0x01);  // retain off, the broker retains nothing
    }
    MqttWireConfig c = deviceConfig("broker.example", 8883, "hub-k7qm2xpd", "s3cretpass");
    TEST_ASSERT_EQUAL_STRING("hub-k7qm2xpd", c.clientId);
    TEST_ASSERT_EQUAL_STRING("hub-k7qm2xpd", c.user);
    TEST_ASSERT_EQUAL(8883, c.port);
    uint8_t pkt[128];
    size_t n = buildConnect(pkt, sizeof pkt, c);
    // after the 10 byte fixed part the first string is the client id, then the user name
    TEST_ASSERT_EQUAL(12, pkt[2 + 10 + 1]);
    TEST_ASSERT_EQUAL_MEMORY("hub-k7qm2xpd", pkt + 2 + 10 + 2, 12);
    TEST_ASSERT_EQUAL_MEMORY("hub-k7qm2xpd", pkt + 2 + 10 + 2 + 12 + 2, 12);
    TEST_ASSERT_TRUE(n > 40);
}

// the worked example in docs/protocol.md and the RFC 4231 test cases for the HMAC itself
void test_the_broker_password_is_the_documented_hmac_not_the_secret() {
    char pw[65];
    brokerPassword("mph_EXAMPLE-secret-for-the-docs-0123456789abcdefABCDEF", pw);
    TEST_ASSERT_EQUAL_STRING("189c20803646ddce9ef9c008449266de589380c1b0873647c9f53cf763a77cca", pw);
    // RFC 4231 test case 2
    uint8_t mac[32];
    hmacSha256((const uint8_t *)"Jefe", 4, (const uint8_t *)"what do ya want for nothing?", 28, mac);
    static const uint8_t want[32] = {0x5b, 0xdc, 0xc1, 0x46, 0xbf, 0x60, 0x75, 0x4e, 0x6a, 0x04, 0x24, 0x26, 0x08, 0x95, 0x75, 0xc7,
                                     0x5a, 0x00, 0x3f, 0x08, 0x9d, 0x27, 0x39, 0x83, 0x9d, 0xec, 0x58, 0xb9, 0x64, 0xec, 0x38, 0x43};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, mac, 32);
    // RFC 4231 test case 6: a key longer than the block (131 bytes of 0xaa)
    uint8_t longKey[131];
    memset(longKey, 0xaa, sizeof longKey);
    hmacSha256(longKey, sizeof longKey, (const uint8_t *)"Test Using Larger Than Block-Size Key - Hash Key First", 54, mac);
    static const uint8_t want6[32] = {0x60, 0xe4, 0x31, 0x59, 0x1e, 0xe0, 0xb6, 0x7f, 0x0d, 0x8a, 0x26, 0xaa, 0xcb, 0xf5, 0xb7, 0x7f,
                                      0x8e, 0x0b, 0xc6, 0x21, 0x37, 0x28, 0xc5, 0x14, 0x05, 0x46, 0x04, 0x0f, 0x0e, 0xe3, 0x7f, 0x54};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want6, mac, 32);
    // and the CONNECT packet carries the password, not the secret
    MqttWireConfig c = deviceConfig("b", 8883, "hub-k7qm2xpd", pw);
    uint8_t pkt[200];
    size_t n = buildConnect(pkt, sizeof pkt, c);
    std::string bytes((const char *)pkt, n);
    TEST_ASSERT_TRUE(bytes.find(pw) != std::string::npos);
    TEST_ASSERT_TRUE(bytes.find("mph_EXAMPLE") == std::string::npos);
    // the example secret is accepted as a device secret
    FakeKv kv;
    IdentityStore s(kv);
    const char *why = "";
    TEST_ASSERT_TRUE(s.setDevice("hub-k7qm2xpd", "mph_EXAMPLE-secret-for-the-docs-0123456789abcdefABCDEF", &why));
}

void test_publish_refuses_what_it_cannot_send() {
    uint8_t out[64];
    uint8_t body[100] = {0};
    TEST_ASSERT_EQUAL(0, (int)buildPublish(out, sizeof out, "a/b", body, 100, false, 0, false));  // no room
    TEST_ASSERT_EQUAL(0, (int)buildPublish(out, sizeof out, "", body, 1, false, 0, false));
    TEST_ASSERT_EQUAL(0, (int)buildPublish(out, sizeof out, "a", body, 1, true, 0, false));       // QoS 1 needs an id
    TEST_ASSERT_EQUAL(0, (int)buildPublish(out, sizeof out, "a", nullptr, 1, false, 0, false));
    TEST_ASSERT_EQUAL(0, (int)buildPublish(out, sizeof out, nullptr, body, 1, false, 0, false));
}

static InboundPacket feedAll(InboundParser &p, std::vector<uint8_t> bytes) {
    InboundPacket last{Inbound::None, 0, 0};
    for (uint8_t b : bytes) {
        last = p.feed(b);
        if (last.type != Inbound::None) {
            return last;
        }
    }
    return last;
}

void test_inbound_packets_are_parsed_and_everything_else_is_a_fault() {
    InboundParser p;
    InboundPacket a = feedAll(p, {0x20, 0x02, 0x00, 0x00});
    TEST_ASSERT_TRUE(a.type == Inbound::ConnAck);
    TEST_ASSERT_EQUAL(0, a.code);
    a = feedAll(p, {0x20, 0x02, 0x00, 0x05});
    TEST_ASSERT_TRUE(a.type == Inbound::ConnAck && a.code == 5);
    a = feedAll(p, {0x40, 0x02, 0x12, 0x34});
    TEST_ASSERT_TRUE(a.type == Inbound::PubAck && a.id == 0x1234);
    a = feedAll(p, {0xD0, 0x00});
    TEST_ASSERT_TRUE(a.type == Inbound::PingResp);
    // a hub never subscribes, so a PUBLISH, a SUBACK or a CONNACK with a reserved flag is a fault
    for (uint8_t t : {0x30, 0x32, 0x90, 0xB0, 0x50, 0x60, 0x70, 0xE0, 0x00, 0xFF}) {
        InboundParser q;
        TEST_ASSERT_TRUE(q.feed(t).type == Inbound::Bad);
        TEST_ASSERT_TRUE(q.feed(0).type == Inbound::Bad);  // and it stays a fault
    }
    InboundParser r;
    TEST_ASSERT_TRUE(feedAll(r, {0x20, 0x03, 0, 0}).type == Inbound::Bad);   // wrong length for CONNACK
    InboundParser s;
    TEST_ASSERT_TRUE(feedAll(s, {0x20, 0x02, 0x02, 0x00}).type == Inbound::Bad);  // reserved bits set
    InboundParser t;
    TEST_ASSERT_TRUE(feedAll(t, {0xD0, 0x01}).type == Inbound::Bad);
}

struct Rig {
    FakeClock clock;
    FakeTransport tr;
    MqttWireConfig cfg = config();
    MqttWireClient client{clock, tr, cfg};
    Rig() { tr.clock = &clock; }
};

void test_connect_success_and_the_ways_it_fails() {
    {
        Rig r;
        TEST_ASSERT_TRUE(r.client.connect());
        TEST_ASSERT_TRUE(r.client.connected());
        TEST_ASSERT_EQUAL(0x10, r.tr.toBroker[0]);
    }
    {
        Rig r;
        r.tr.connackCode = 5;  // not authorised: the login is wrong or removed
        TEST_ASSERT_FALSE(r.client.connect());
        TEST_ASSERT_EQUAL(5, r.client.refusal());
        TEST_ASSERT_FALSE(r.client.connected());
        TEST_ASSERT_FALSE(r.tr.isOpen());
    }
    {
        Rig r;
        r.tr.allowOpen = false;
        TEST_ASSERT_FALSE(r.client.connect());
    }
    {
        Rig r;
        r.tr.answerConnect = false;  // the broker never answers
        uint32_t start = r.clock.now;
        TEST_ASSERT_FALSE(r.client.connect());
        uint32_t waited = r.clock.now - start;
        TEST_ASSERT_TRUE(waited >= 5000 && waited <= 5010);  // the 5 s CONNACK time-out
        TEST_ASSERT_FALSE(r.tr.isOpen());
    }
}

void test_qos1_publish_is_acknowledged_and_ids_never_hit_zero() {
    Rig r;
    r.client.connect();
    const uint8_t body[2] = {'o', 'k'};
    int id = r.client.publish("melophos/hub-abc/notes", body, 2, true);
    TEST_ASSERT_TRUE(id > 0);
    TEST_ASSERT_EQUAL(0x32, r.tr.toBroker[42]);  // the PUBLISH follows the 42 byte CONNECT, flags: QoS 1
    r.client.service();
    int acked = 0;
    TEST_ASSERT_TRUE(r.client.pollAck(acked));
    TEST_ASSERT_EQUAL(id, acked);
    TEST_ASSERT_FALSE(r.client.pollAck(acked));
    TEST_ASSERT_EQUAL(0, r.client.publish("melophos/hub-abc/status", body, 2, false));  // QoS 0 has no id
    for (int i = 0; i < 70000; i++) {
        int x = r.client.publish("t", body, 2, true);
        TEST_ASSERT_TRUE(x > 0);
        r.tr.toBroker.clear();
        r.tr.fromBroker.clear();
    }
}

void test_publish_without_a_connection_or_too_big_fails_cleanly() {
    Rig r;
    const uint8_t body[2] = {1, 2};
    TEST_ASSERT_TRUE(r.client.publish("t", body, 2, true) < 0);
    r.client.connect();
    std::vector<uint8_t> big(MqttWireClient::kMaxPacket, 0);
    TEST_ASSERT_TRUE(r.client.publish("t", big.data(), big.size(), true) < 0);
    TEST_ASSERT_TRUE(r.client.connected());  // a bad request does not take the link down
}

void test_keep_alive_pings_and_drops_a_silent_broker() {
    Rig r;
    r.client.connect();
    r.tr.toBroker.clear();
    r.clock.advance(14999);
    r.client.service();
    TEST_ASSERT_EQUAL(0, (int)r.tr.toBroker.size());  // under half the interval of silence
    r.clock.advance(1);
    r.client.service();
    TEST_ASSERT_EQUAL(2, (int)r.tr.toBroker.size());
    TEST_ASSERT_EQUAL(0xC0, r.tr.toBroker[0]);
    r.clock.advance(MqttWireClient::kPingAnswerMs - 1);
    r.client.service();
    TEST_ASSERT_TRUE(r.client.connected());
    r.clock.advance(1);
    r.client.service();
    TEST_ASSERT_FALSE(r.client.connected());  // no PINGRESP: the broker is gone
    // and a ping that is answered keeps the link
    Rig q;
    q.client.connect();
    q.clock.advance(15000);
    q.client.service();
    q.tr.fromBroker.insert(q.tr.fromBroker.end(), {0xD0, 0x00});
    q.clock.advance(5000);
    q.client.service();
    q.clock.advance(20000);
    q.client.service();
    TEST_ASSERT_TRUE(q.client.connected());
}

void test_broker_faults_drop_the_connection() {
    {
        Rig r;
        r.client.connect();
        r.tr.fromBroker.insert(r.tr.fromBroker.end(), {0x30, 0x03, 0, 1, 'x'});  // a PUBLISH to a hub that never subscribed
        r.client.service();
        TEST_ASSERT_FALSE(r.client.connected());
    }
    {
        Rig r;
        r.client.connect();
        r.tr.fromBroker.insert(r.tr.fromBroker.end(), {0x20, 0x02, 0x00, 0x00});  // a second CONNACK
        r.client.service();
        TEST_ASSERT_FALSE(r.client.connected());
    }
    {
        Rig r;
        r.client.connect();
        r.tr.open_ = false;  // the socket died
        r.client.service();
        TEST_ASSERT_FALSE(r.client.connected());
    }
}

void test_disconnect_says_goodbye() {
    Rig r;
    r.client.connect();
    r.tr.toBroker.clear();
    r.client.disconnect();
    TEST_ASSERT_EQUAL(2, (int)r.tr.toBroker.size());
    TEST_ASSERT_EQUAL(0xE0, r.tr.toBroker[0]);
    TEST_ASSERT_FALSE(r.client.connected());
}

// the whole stack: queue, link, wire client and a fake socket
static NoteEvent note(uint32_t t, uint8_t n) {
    return NoteEvent{t, n, 80, 0, NoteSource::UsbMidi};
}

void test_link_over_the_wire_delivers_a_session_and_resends_after_a_lost_ack() {
    FakeClock clock;
    FakeTransport tr;
    tr.clock = &clock;
    MqttWireConfig cfg = config();
    MqttWireClient wire(clock, tr, cfg);
    FakeWall wall;
    wall.epoch = 1767225600;
    OfflineQueue queue;
    MqttLink link(clock, wire, queue, wall, "hub-abc", 9);
    SessionPublisher pub(queue, wall, 9);
    pub.onNote(note(0, 60));
    clock.advance(SessionPublisher::kIdleGapMs + 1);
    pub.tick(clock.now);
    tr.autoPuback = false;  // the broker takes the bytes but never acknowledges
    link.pump();
    std::vector<uint8_t> firstSend = tr.toBroker;
    TEST_ASSERT_EQUAL(2, (int)queue.size());
    clock.advance(MqttLink::kAckTimeoutMs);
    link.pump();  // time-out and drop
    TEST_ASSERT_FALSE(wire.connected());
    tr.autoPuback = true;
    tr.toBroker.clear();
    clock.advance(70000);
    for (int i = 0; i < 10; i++) {
        link.pump();
        clock.advance(1);
    }
    TEST_ASSERT_EQUAL(0, (int)queue.size());
    TEST_ASSERT_TRUE(link.resends() >= 1);
    // the first notes packet and its resend are identical apart from the packet id
    std::string a(firstSend.begin(), firstSend.end());
    std::string b(tr.toBroker.begin(), tr.toBroker.end());
    size_t body = a.find("{\"boot\":9,\"seq\":1,\"session_ref\"");
    TEST_ASSERT_TRUE(body != std::string::npos);
    TEST_ASSERT_TRUE(b.find(a.substr(body, 200)) != std::string::npos);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_connect_packet_is_exactly_the_mqtt_311_layout);
    RUN_TEST(test_publish_packets_at_both_qos_and_long_lengths);
    RUN_TEST(test_publish_never_sets_the_retain_flag_and_the_client_id_is_the_device_id);
    RUN_TEST(test_the_broker_password_is_the_documented_hmac_not_the_secret);
    RUN_TEST(test_publish_refuses_what_it_cannot_send);
    RUN_TEST(test_inbound_packets_are_parsed_and_everything_else_is_a_fault);
    RUN_TEST(test_connect_success_and_the_ways_it_fails);
    RUN_TEST(test_qos1_publish_is_acknowledged_and_ids_never_hit_zero);
    RUN_TEST(test_publish_without_a_connection_or_too_big_fails_cleanly);
    RUN_TEST(test_keep_alive_pings_and_drops_a_silent_broker);
    RUN_TEST(test_broker_faults_drop_the_connection);
    RUN_TEST(test_disconnect_says_goodbye);
    RUN_TEST(test_link_over_the_wire_delivers_a_session_and_resends_after_a_lost_ack);
    return UNITY_END();
}
