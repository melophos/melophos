#pragma once

#include <stdint.h>
#include <string.h>

#include <algorithm>
#include <map>
#include <string>
#include <vector>

#include "blemidi.h"
#include "hal.h"
#include "midi.h"
#include "mqttlink.h"
#include "identity.h"
#include "mqttwire.h"
#include "ota.h"
#include "pairing.h"
#include "publish.h"
#include "usbhost.h"

namespace melophos {

class FakeClock : public Clock {
   public:
    uint32_t now = 0;
    uint32_t nowMs() const override { return now; }
    void advance(uint32_t ms) { now += ms; }
};

// NOR flash with a power cut that can land on any step. One step is one erase
// half or one programmed byte. A cut mid-erase leaves garbage (the real chip's
// content is undefined) and a cut mid-program leaves the bytes written so far.
class FakeFlash : public Flash {
   public:
    FakeFlash(uint32_t sectors = 20, uint32_t sectorBytes = 4096) : sectors_(sectors), size_(sectorBytes) {
        data_.assign((size_t)sectors * sectorBytes, 0xFF);
        wear_.assign(sectors, 0);
    }
    uint32_t sectorSize() const override { return size_; }
    uint32_t sectorCount() const override { return sectors_; }

    bool erase(uint32_t sector) override {
        if (sector >= sectors_ || !step()) {
            return false;
        }
        uint8_t *s = &data_[(size_t)sector * size_];
        uint32_t seed = sector * 2654435761u + steps_;
        for (uint32_t i = 0; i < size_; i++) {
            seed = seed * 1664525u + 1013904223u;
            s[i] = (uint8_t)(seed >> 24);
        }
        if (!step()) {
            return false;
        }
        memset(s, 0xFF, size_);
        wear_[sector]++;
        erases_++;
        return true;
    }
    bool read(uint32_t address, void *out, size_t length) const override {
        if ((uint64_t)address + length > data_.size()) {
            return false;
        }
        memcpy(out, &data_[address], length);
        return true;
    }
    bool program(uint32_t address, const void *in, size_t length) override {
        if ((uint64_t)address + length > data_.size()) {
            return false;
        }
        const uint8_t *src = static_cast<const uint8_t *>(in);
        for (size_t i = 0; i < length; i++) {
            if (!step()) {
                return false;
            }
            data_[address + i] &= src[i];  // bits only go from 1 to 0
        }
        return true;
    }

    // fail every call once n more steps have happened; -1 means never
    void cutAfter(long n) { budget_ = n; }
    void restorePower() { budget_ = -1; }
    long steps() const { return steps_; }
    void resetCounters() {
        steps_ = 0;
        erases_ = 0;
    }
    long erases() const { return erases_; }
    uint32_t wear(uint32_t sector) const { return wear_[sector]; }
    std::vector<uint8_t> &raw() { return data_; }

   private:
    bool step() {
        if (budget_ == 0) {
            return false;
        }
        if (budget_ > 0) {
            budget_--;
        }
        steps_++;
        return true;
    }
    uint32_t sectors_;
    uint32_t size_;
    std::vector<uint8_t> data_;
    std::vector<uint32_t> wear_;
    long budget_ = -1;
    long steps_ = 0;
    long erases_ = 0;
};

class FakeLedSink : public LedSink {
   public:
    explicit FakeLedSink(FakeClock *clock = nullptr, uint32_t showMs = 0) : clock_(clock), showMs_(showMs) {}
    std::vector<Rgb> last;
    int shows = 0;
    void show(const Rgb *pixels, size_t count) override {
        last.assign(pixels, pixels + count);
        shows++;
        if (clock_) {
            clock_->advance(showMs_);  // a real show() blocks while the bits go out
        }
    }

   private:
    FakeClock *clock_;
    uint32_t showMs_;
};


class CollectSink : public MidiSink {
   public:
    std::vector<NoteEvent> notes;
    int allOff = 0;
    void note(const NoteEvent &e) override { notes.push_back(e); }
    void allNotesOff(uint8_t) override { allOff++; }
};

class FakePower : public UsbPower {
   public:
    bool on = false;
    int switches = 0;
    void setVbus(bool v) override {
        if (v != on) {
            switches++;
        }
        on = v;
    }
};

class FakeUsbPort : public UsbHostPort {
   public:
    int enumerations = 0;
    int releases = 0;
    void beginEnumeration() override { enumerations++; }
    void release() override { releases++; }
};

class FakeBlePort : public BlePort {
   public:
    int advertising = 0;
    bool accept = true;
    std::vector<std::vector<uint8_t>> sent;
    void startAdvertising() override { advertising++; }
    bool notify(const uint8_t *d, size_t n) override {
        if (!accept) {
            return false;
        }
        sent.emplace_back(d, d + n);
        return true;
    }
};

class FakeWall : public WallClock {
   public:
    int64_t epoch = 0;
    int64_t epochSeconds() const override { return epoch; }
};

// real time that moves with the fake clock
class ClockWall : public WallClock {
   public:
    ClockWall(const FakeClock &c, int64_t base) : c_(c), base_(base) {}
    int64_t epochSeconds() const override { return base_ + (int64_t)c_.now / 1000; }

   private:
    const FakeClock &c_;
    int64_t base_;
};

class StringSink : public ChunkSink {
   public:
    std::string text;
    bool write(const char *d, size_t n) override {
        text.append(d, n);
        return true;
    }
};

class FakeMqtt : public MqttClient {
   public:
    struct Message {
        std::string topic;
        std::string payload;
        bool qos1;
        int id;
    };
    bool up = false;
    bool allowConnect = true;
    bool failPublish = false;
    int refuse = 0;        // a CONNACK return code that refuses the login (5 is not authorised)
    bool autoAck = true;   // the broker acknowledges every QoS 1 publish at once
    bool dropAcks = false; // the broker takes the message but its PUBACK never arrives
    int connects = 0;
    std::vector<Message> sent;
    bool connected() override { return up; }
    bool connect() override {
        connects++;
        up = allowConnect && refuse == 0;
        acks_.clear();
        return up;
    }
    int refusal() override { return refuse; }
    void disconnect() override { up = false; }
    int publish(const char *topic, const uint8_t *payload, size_t length, bool qos1) override {
        if (!up || failPublish) {
            return -1;
        }
        int id = qos1 ? ++lastId_ : 0;
        sent.push_back(Message{topic, std::string((const char *)payload, length), qos1, id});
        if (qos1 && autoAck && !dropAcks) {
            acks_.push_back(id);
        }
        return qos1 ? id : 0;
    }
    bool pollAck(int &id) override {
        if (acks_.empty()) {
            return false;
        }
        id = acks_.front();
        acks_.erase(acks_.begin());
        return true;
    }
    void service() override {}
    void ackNow(int id) { acks_.push_back(id); }

   private:
    std::vector<int> acks_;
    int lastId_ = 0;
};

class FakeTransport : public Transport {
   public:
    bool allowOpen = true;
    bool open_ = false;
    bool answerConnect = true;
    uint8_t connackCode = 0;
    bool autoPuback = true;
    int idles = 0;
    std::vector<uint8_t> toBroker;
    std::vector<uint8_t> fromBroker;
    FakeClock *clock = nullptr;
    bool open(const char *, uint16_t) override {
        open_ = allowOpen;
        return open_;
    }
    int read(uint8_t *out, size_t cap) override {
        if (!open_) {
            return -1;
        }
        size_t n = std::min(cap, fromBroker.size());
        // an empty vector's data() may be null and memcpy from null is undefined even for no bytes
        if (n > 0) {
            memcpy(out, fromBroker.data(), n);
        }
        fromBroker.erase(fromBroker.begin(), fromBroker.begin() + (long)n);
        return (int)n;
    }
    bool write(const uint8_t *d, size_t n) override {
        if (!open_) {
            return false;
        }
        toBroker.insert(toBroker.end(), d, d + n);
        if (n > 0 && d[0] == 0x10 && answerConnect) {
            fromBroker.insert(fromBroker.end(), {0x20, 0x02, 0x00, connackCode});
        }
        if (n > 4 && (d[0] & 0xF6) == 0x32 && autoPuback) {
            // QoS 1 publish: find the packet id after the topic
            size_t at = 1;
            while (d[at] & 0x80) {
                at++;
            }
            at++;
            size_t tl = (size_t)((d[at] << 8) | d[at + 1]);
            at += 2 + tl;
            fromBroker.insert(fromBroker.end(), {0x40, 0x02, d[at], d[at + 1]});
        }
        return true;
    }
    void close() override { open_ = false; }
    bool isOpen() override { return open_; }
    void idle() override {
        idles++;
        if (clock) {
            clock->advance(1);
        }
    }
};

class FakeKv : public KeyValueStore {
   public:
    std::map<std::string, std::string> data;
    bool failPut = false;
    bool get(const char *key, char *out, size_t cap, size_t &length) override {
        auto it = data.find(key);
        length = 0;
        if (it == data.end() || it->second.size() > cap) {
            return false;
        }
        if (!it->second.empty()) {
            memcpy(out, it->second.data(), it->second.size());
        }
        length = it->second.size();
        return true;
    }
    bool put(const char *key, const char *value, size_t length) override {
        if (failPut) {
            return false;
        }
        data[key] = std::string(value, length);
        return true;
    }
    bool erase(const char *key) override {
        data.erase(key);
        return true;
    }
};

class FakeHttps : public HttpsPort {
   public:
    std::vector<HttpReply> identityReplies;  // taken in order, the last one repeats
    std::vector<HttpReply> deviceReplies;
    int identityCalls = 0;
    int deviceCalls = 0;
    std::string lastId, lastSecret;
    std::vector<HttpReply> removeReplies;
    int removeCalls = 0;
    std::string lastRemoveId, lastRemoveSecret;
    static HttpReply reply(int status, const char *body, uint32_t retry = 0) {
        HttpReply r{};
        r.status = status;
        r.retryAfterS = retry;
        r.length = strlen(body);
        memcpy(r.body, body, r.length);
        return r;
    }
    bool requestIdentity(HttpReply &out) override {
        size_t i = std::min((size_t)identityCalls, identityReplies.size() - 1);
        identityCalls++;
        out = identityReplies[i];
        return true;
    }
    bool checkDevice(const char *id, const char *secret, HttpReply &out) override {
        lastId = id;
        lastSecret = secret;
        size_t i = std::min((size_t)deviceCalls, deviceReplies.size() - 1);
        deviceCalls++;
        out = deviceReplies[i];
        return true;
    }
    bool removeClaim(const char *id, const char *secret, HttpReply &out) override {
        removeCalls++;
        lastRemoveId = id;
        lastRemoveSecret = secret;
        out = removeReplies.empty() ? reply(0, "") : removeReplies[0];
        return true;
    }
};

class FakeSlot : public FirmwareSlot {
   public:
    size_t cap = 4096;
    std::vector<uint8_t> image;
    int begins = 0, commits = 0, aborts = 0, valids = 0, rollbacks = 0, writes = 0;
    bool failBegin = false, failCommit = false;
    long failWriteAfter = -1;  // bytes accepted before writes start failing
    bool open = false;
    size_t capacity() const override { return cap; }
    bool begin(size_t size) override {
        begins++;
        if (failBegin || size > cap) {
            return false;
        }
        image.clear();
        open = true;
        return true;
    }
    bool write(const uint8_t *d, size_t n) override {
        writes++;
        if (!open || (failWriteAfter >= 0 && (long)(image.size() + n) > failWriteAfter)) {
            return false;
        }
        image.insert(image.end(), d, d + n);
        return true;
    }
    bool commit() override {
        commits++;
        return !failCommit;
    }
    void abort() override {
        aborts++;
        open = false;
        image.clear();
    }
    bool markValid() override {
        valids++;
        return true;
    }
    void rollback() override { rollbacks++; }
};

class FakeFetcher : public Fetcher {
   public:
    std::string manifest;  // returned for URLs ending in manifest
    std::vector<uint8_t> image;
    size_t chunk = 100;
    bool failManifest = false;
    long failImageAfter = -1;  // bytes delivered before the connection drops
    int gets = 0;
    bool get(const char *url, size_t maxBytes, bool (*onData)(void *, const uint8_t *, size_t), void *ctx) override {
        gets++;
        std::string u = url;
        if (u.find("manifest") != std::string::npos) {
            if (failManifest) {
                return false;
            }
            return onData(ctx, (const uint8_t *)manifest.data(), manifest.size());
        }
        size_t sent = 0;
        while (sent < image.size()) {
            size_t n = std::min(chunk, image.size() - sent);
            if (failImageAfter >= 0 && (long)(sent + n) > failImageAfter) {
                return false;
            }
            if (sent + n > maxBytes + chunk * 4) {
                return false;  // a real client stops reading at a cap
            }
            if (!onData(ctx, image.data() + sent, n)) {
                return false;
            }
            sent += n;
        }
        return true;
    }
};

}  // namespace melophos
