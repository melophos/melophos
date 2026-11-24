#include "mqttwire.h"

#include <string.h>

namespace melophos {

namespace {

bool putString(uint8_t *out, size_t cap, size_t &at, const char *s) {
    size_t n = strlen(s);
    if (n > 65535 || at + 2 + n > cap) {
        return false;
    }
    out[at++] = (uint8_t)(n >> 8);
    out[at++] = (uint8_t)n;
    memcpy(out + at, s, n);
    at += n;
    return true;
}

// remaining length is a 1 to 4 byte variable integer
size_t putRemaining(uint8_t *out, size_t value) {
    size_t n = 0;
    do {
        uint8_t b = (uint8_t)(value % 128);
        value /= 128;
        if (value > 0) {
            b |= 0x80;
        }
        out[n++] = b;
    } while (value > 0);
    return n;
}

}  // namespace

size_t buildConnect(uint8_t *out, size_t cap, const MqttWireConfig &c) {
    uint8_t body[300];
    size_t at = 0;
    static const uint8_t head[] = {0, 4, 'M', 'Q', 'T', 'T', 4, 0xC2};  // 3.1.1, user, password, clean session
    memcpy(body, head, sizeof head);
    at = sizeof head;
    body[at++] = (uint8_t)(c.keepAliveS >> 8);
    body[at++] = (uint8_t)c.keepAliveS;
    if (!c.clientId || !c.user || !c.password || c.clientId[0] == '\0' ||  //
        !putString(body, sizeof body, at, c.clientId) || !putString(body, sizeof body, at, c.user) ||
        !putString(body, sizeof body, at, c.password)) {
        return 0;
    }
    uint8_t rl[4];
    size_t rn = putRemaining(rl, at);
    if (1 + rn + at > cap) {
        return 0;
    }
    out[0] = 0x10;
    memcpy(out + 1, rl, rn);
    memcpy(out + 1 + rn, body, at);
    return 1 + rn + at;
}

size_t buildPublish(uint8_t *out, size_t cap, const char *topic, const uint8_t *payload, size_t length, bool qos1,
                    uint16_t packetId, bool dup) {
    size_t tl = topic ? strlen(topic) : 0;
    if (tl == 0 || tl > 255 || (length > 0 && payload == nullptr) || (qos1 && packetId == 0)) {
        return 0;
    }
    size_t remaining = 2 + tl + (qos1 ? 2 : 0) + length;
    uint8_t rl[4];
    if (remaining > 268435455) {
        return 0;
    }
    size_t rn = putRemaining(rl, remaining);
    if (1 + rn + remaining > cap) {
        return 0;
    }
    size_t at = 0;
    out[at++] = (uint8_t)(0x30 | (qos1 ? 0x02 : 0) | (dup ? 0x08 : 0));
    memcpy(out + at, rl, rn);
    at += rn;
    out[at++] = (uint8_t)(tl >> 8);
    out[at++] = (uint8_t)tl;
    memcpy(out + at, topic, tl);
    at += tl;
    if (qos1) {
        out[at++] = (uint8_t)(packetId >> 8);
        out[at++] = (uint8_t)packetId;
    }
    if (length) {
        memcpy(out + at, payload, length);
    }
    return at + length;
}

InboundPacket InboundParser::feed(uint8_t b) {
    InboundPacket none{Inbound::None, 0, 0};
    if (bad_) {
        return InboundPacket{Inbound::Bad, 0, 0};
    }
    if (count_ == 0) {
        // the packets a hub may receive: CONNACK, PUBACK and PINGRESP, all tiny
        switch (b) {
            case 0x20:
                need_ = 4;
                break;
            case 0x40:
                need_ = 4;
                break;
            case 0xD0:
                need_ = 2;
                break;
            default:
                bad_ = true;
                return InboundPacket{Inbound::Bad, 0, 0};
        }
        buf_[count_++] = b;
        return none;
    }
    buf_[count_++] = b;
    if (count_ < need_) {
        return none;
    }
    uint8_t type = buf_[0];
    count_ = 0;
    if (type == 0x20 && buf_[1] == 2) {
        if (buf_[2] > 1) {
            return InboundPacket{Inbound::Bad, 0, 0};
        }
        return InboundPacket{Inbound::ConnAck, buf_[3], 0};
    }
    if (type == 0x40 && buf_[1] == 2) {
        return InboundPacket{Inbound::PubAck, 0, (uint16_t)((buf_[2] << 8) | buf_[3])};
    }
    if (type == 0xD0 && buf_[1] == 0) {
        return InboundPacket{Inbound::PingResp, 0, 0};
    }
    bad_ = true;  // a wrong length for the type
    return InboundPacket{Inbound::Bad, 0, 0};
}

bool MqttWireClient::send(const uint8_t *data, size_t n) {
    if (!transport_.write(data, n)) {
        drop();
        return false;
    }
    lastSendMs_ = clock_.nowMs();
    return true;
}

void MqttWireClient::drop() {
    transport_.close();
    parser_.reset();
    up_ = false;
    pingOutstanding_ = false;
    ackCount_ = 0;
}

bool MqttWireClient::connected() {
    return up_ && transport_.isOpen();
}

void MqttWireClient::disconnect() {
    if (up_ && transport_.isOpen()) {
        static const uint8_t bye[] = {0xE0, 0x00};
        transport_.write(bye, sizeof bye);
    }
    drop();
}

bool MqttWireClient::connect() {
    drop();
    refusal_ = 0;
    parser_.reset();
    if (!transport_.open(config_.host, config_.port)) {
        return false;
    }
    size_t n = buildConnect(packet_, sizeof packet_, config_);
    if (n == 0 || !send(packet_, n)) {
        drop();
        return false;
    }
    uint32_t started = clock_.nowMs();
    while ((uint32_t)(clock_.nowMs() - started) < kConnackTimeoutMs) {
        uint8_t b;
        int r = transport_.read(&b, 1);
        if (r < 0) {
            drop();
            return false;
        }
        if (r == 0) {
            transport_.idle();
            continue;
        }
        InboundPacket p = parser_.feed(b);
        if (p.type == Inbound::ConnAck) {
            if (p.code != 0) {
                refusal_ = p.code;
                drop();  // refused: wrong or removed login
                return false;
            }
            up_ = true;
            lastSendMs_ = clock_.nowMs();
            return true;
        }
        if (p.type == Inbound::Bad) {
            drop();
            return false;
        }
    }
    drop();
    return false;
}

int MqttWireClient::publish(const char *topic, const uint8_t *payload, size_t length, bool qos1) {
    if (!connected()) {
        return -1;
    }
    uint16_t id = 0;
    if (qos1) {
        id = nextId_++;
        if (nextId_ == 0) {
            nextId_ = 1;  // 0 is not a valid packet id
        }
    }
    size_t n = buildPublish(packet_, sizeof packet_, topic, payload, length, qos1, id, false);
    if (n == 0) {
        return -1;
    }
    if (!send(packet_, n)) {
        return -1;
    }
    return qos1 ? (int)id : 0;
}

bool MqttWireClient::pollAck(int &id) {
    if (ackCount_ == 0) {
        return false;
    }
    id = acks_[0];
    memmove(acks_, acks_ + 1, sizeof(int) * (--ackCount_));
    return true;
}

void MqttWireClient::handle(const InboundPacket &p) {
    switch (p.type) {
        case Inbound::PubAck:
            if (ackCount_ < sizeof acks_ / sizeof acks_[0]) {
                acks_[ackCount_++] = p.id;
            }
            break;
        case Inbound::PingResp:
            pingOutstanding_ = false;
            break;
        case Inbound::Bad:
        case Inbound::ConnAck:  // a second CONNACK is a fault too
            drop();
            break;
        default:
            break;
    }
}

void MqttWireClient::service() {
    if (!connected()) {
        return;
    }
    uint8_t buf[64];
    for (int guard = 0; guard < 8; guard++) {
        int r = transport_.read(buf, sizeof buf);
        if (r < 0) {
            drop();
            return;
        }
        if (r == 0) {
            break;
        }
        for (int i = 0; i < r && up_; i++) {
            handle(parser_.feed(buf[i]));
        }
        if (!up_) {
            return;
        }
    }
    uint32_t now = clock_.nowMs();
    uint32_t half = (uint32_t)config_.keepAliveS * 500u;
    if (pingOutstanding_ && (uint32_t)(now - pingSentMs_) >= kPingAnswerMs) {
        drop();  // the broker went quiet
        return;
    }
    if (!pingOutstanding_ && (uint32_t)(now - lastSendMs_) >= half) {
        static const uint8_t ping[] = {0xC0, 0x00};
        if (send(ping, sizeof ping)) {
            pingOutstanding_ = true;
            pingSentMs_ = now;
        }
    }
}

}  // namespace melophos
