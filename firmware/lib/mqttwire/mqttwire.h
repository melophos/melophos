#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "mqttlink.h"

namespace melophos {

// the socket under the MQTT client. The real one is a TLS client (see
// src/tls_transport.*) that verifies the broker's certificate. Reads never
// block: 0 means nothing yet and a negative number means the connection is gone.
class Transport {
   public:
    virtual ~Transport() {}
    // blocks for at most its own time-out (5 s)
    virtual bool open(const char *host, uint16_t port) = 0;
    virtual int read(uint8_t *out, size_t cap) = 0;
    virtual bool write(const uint8_t *data, size_t length) = 0;
    virtual void close() = 0;
    virtual bool isOpen() = 0;
    // called while waiting for an answer: sleep a millisecond (a no-op on the host)
    virtual void idle() = 0;
};

struct MqttWireConfig {
    const char *host;
    uint16_t port;
    const char *clientId;  // the device id
    const char *user;      // the device id
    const char *password;  // the device secret
    uint16_t keepAliveS;   // 30 to 60 as the protocol asks
};

// the login the server's broker accepts: the user name and the client id are both the device id and the
// password is hex(HMAC-SHA256(key = device secret, message = "mqtt")) (see brokerPassword), never the secret
// itself. brokerPasswordHex must be the 64 characters that function gives and outlive the config
inline MqttWireConfig deviceConfig(const char *host, uint16_t port, const char *deviceId, const char *brokerPasswordHex) {
    return MqttWireConfig{host, port, deviceId, deviceId, brokerPasswordHex, 30};
}

// what a packet that came from the broker turned out to be.
enum class Inbound : uint8_t { None, ConnAck, PubAck, PingResp, Bad };
struct InboundPacket {
    Inbound type;
    uint8_t code;     // CONNACK return code
    uint16_t id;      // PUBACK packet id
};

// MQTT 3.1.1, only what a hub needs: connect, publish at QoS 0 or 1, ping,
// disconnect. A hub never subscribes, so any other packet from the broker is
// treated as a fault and the connection is dropped.
//   connect time-out     5 s for the CONNACK
//   PUBACK time-out      the caller's (MqttLink uses 10 s)
//   keep alive           a ping after half the interval of silence and a drop
//                        if no answer comes within 10 s
// Packet building and parsing are plain functions so they can be fuzzed.
size_t buildConnect(uint8_t *out, size_t cap, const MqttWireConfig &c);
// returns 0 when the topic or payload cannot fit
size_t buildPublish(uint8_t *out, size_t cap, const char *topic, const uint8_t *payload, size_t length, bool qos1,
                    uint16_t packetId, bool dup);
// feeds bytes from the broker one at a time. Returns a finished packet or None
// while more bytes are needed. Bad means a malformed or unexpected packet.
class InboundParser {
   public:
    InboundPacket feed(uint8_t byte);
    // forgets everything, including a fault: a new connection starts clean
    void reset() {
        count_ = 0;
        need_ = 0;
        bad_ = false;
    }

   private:
    uint8_t buf_[8];
    size_t count_ = 0;
    size_t need_ = 0;
    bool bad_ = false;
};

class MqttWireClient : public MqttClient {
   public:
    static const size_t kMaxPacket = 4300;
    static const uint32_t kConnackTimeoutMs = 5000;
    static const uint32_t kPingAnswerMs = 10000;

    MqttWireClient(Clock &clock, Transport &transport, const MqttWireConfig &config)
        : clock_(clock), transport_(transport), config_(config) {}
    bool connected() override;
    bool connect() override;
    void disconnect() override;
    int publish(const char *topic, const uint8_t *payload, size_t length, bool qos1) override;
    bool pollAck(int &id) override;
    void service() override;
    int refusal() override { return refusal_; }

   private:
    int refusal_ = 0;
    Clock &clock_;
    Transport &transport_;
    MqttWireConfig config_;
    InboundParser parser_;
    bool up_ = false;
    uint16_t nextId_ = 1;
    uint32_t lastSendMs_ = 0;
    uint32_t pingSentMs_ = 0;
    bool pingOutstanding_ = false;
    int acks_[8];
    size_t ackCount_ = 0;
    uint8_t packet_[kMaxPacket];

    bool send(const uint8_t *data, size_t n);
    void handle(const InboundPacket &p);
    void drop();
};

}  // namespace melophos
