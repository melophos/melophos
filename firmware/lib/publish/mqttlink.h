#pragma once

#include <string.h>

#include "hal.h"
#include "publish.h"

namespace melophos {

// the broker connection behind a seam. The real one is MqttWireClient over a
// TLS transport (lib/mqttwire). Every call returns within its own time-out.
class MqttClient {
   public:
    virtual ~MqttClient() {}
    virtual bool connected() = 0;
    // blocks for at most the CONNACK time-out (5 s). Runs on the network task, never the LED loop
    virtual bool connect() = 0;
    virtual void disconnect() = 0;
    // QoS 1 returns the packet id (above 0) and the broker's PUBACK is read back with
    // pollAck. QoS 0 returns 0 once the bytes are written. Below 0 means it failed
    virtual int publish(const char *topic, const uint8_t *payload, size_t length, bool qos1) = 0;
    virtual bool pollAck(int &id) = 0;
    virtual void service() = 0;
    // the CONNACK code of the last refused connect (4 or 5 mean the login is wrong or removed), else 0
    virtual int refusal() { return 0; }
};

// stores this run's boot number. Called once, when the broker first accepts the hub and before any
// message is sent. A restart that never reaches the broker therefore writes nothing.
class BootCommit {
   public:
    virtual ~BootCommit() {}
    virtual bool commit(uint32_t boot) = 0;
};

// connects with back-off, publishes status on connect and every 60 s and
// delivers the queue at QoS 1.
//   back-off        1 s, doubling to 60 s, reset by a good connection. A refused
//                   login (not authorised) waits 60 s whatever the back-off
//   one in flight   the next message goes out only when the last was acknowledged,
//                   so the broker and the server always see them in order
//   ack time-out    10 s without a PUBACK drops the connection. After the
//                   reconnect the SAME message goes again with the SAME boot and
//                   seq (fixed when it was first sent), so the server drops a
//                   repeat and nothing is ever sent twice under a different seq
//   queue           a message leaves the queue only on its PUBACK
//   status          QoS 0: a lost status is replaced by the next one
class MqttLink {
   public:
    static const uint32_t kBackoffStartMs = 1000;
    static const uint32_t kBackoffMaxMs = 60000;
    static const uint32_t kAckTimeoutMs = 10000;
    static const uint32_t kRefusedRetryMs = 60000;
    static const int64_t kMaxPastS = 366LL * 86400;
    static const int64_t kMaxFutureS = 86400;
    static const size_t kMaxPayload = 4096;  // anything larger is a bug and is dropped, not sent

    MqttLink(Clock &clock, MqttClient &client, OfflineQueue &queue, const WallClock &wall, const char *deviceId, uint32_t boot)
        : clock_(clock), client_(client), queue_(queue), wall_(wall), boot_(boot) {
        strncpy(deviceId_, deviceId, sizeof deviceId_ - 1);
        deviceId_[sizeof deviceId_ - 1] = '\0';
    }
    void setStatus(const StatusInfo &info) {
        LockGuard g(*statusLock_);
        status_ = info;
    }
    void setBootCommit(BootCommit *c) { commit_ = c; }
    void setStatusLock(Lock *l) { statusLock_ = l ? l : &nullLock_; }
    void pump();
    bool connected() { return client_.connected(); }
    uint32_t connectAttempts() const { return attempts_; }
    uint32_t publishFailures() const { return failures_; }
    uint32_t refusedMessages() const { return refused_; }
    uint32_t resends() const { return resends_; }
    // a session whose start time is outside what the server accepts (more than 366 days back or a day ahead of
    // the hub's believed time) is HELD at the front, never dropped on the clock's word alone: the clock may be the
    // thing that is wrong. It goes when the believed time changes back or a person clears it
    bool holdingStale() const { return holdingStale_; }
    // the person's explicit request (the serial command `queue clear-stale`): drops the stale messages at the
    // front and returns how many. Nothing else ever drops a session for its date
    uint32_t clearStale();
    bool everConnected() const { return everConnected_; }
    // consecutive connects the broker refused as not authorised: the signal to pair again
    uint32_t loginRefusals() const { return loginRefusals_; }

   private:
    Clock &clock_;
    MqttClient &client_;
    OfflineQueue &queue_;
    const WallClock &wall_;
    uint32_t boot_;
    char deviceId_[65] = "";
    StatusInfo status_{"", "", false, false, false, false, 0};
    Lock nullLock_;
    Lock *statusLock_ = &nullLock_;
    uint32_t seq_[3] = {0, 0, 0};
    uint32_t nextAttemptMs_ = 0;
    uint32_t backoffMs_ = kBackoffStartMs;
    uint32_t lastStatusMs_ = 0;
    bool statusDue_ = false;
    int inflight_ = 0;
    uint32_t inflightId_ = 0;
    uint32_t inflightSinceMs_ = 0;
    uint32_t attempts_ = 0;
    uint32_t failures_ = 0;
    uint32_t refused_ = 0;
    uint32_t resends_ = 0;
    bool holdingStale_ = false;
    bool isStale(const QueueEntry &e) const;
    BootCommit *commit_ = nullptr;
    bool committed_ = false;
    uint32_t loginRefusals_ = 0;
    bool everConnected_ = false;
    uint8_t payload_[kMaxPayload];

    bool sendStatus();
    bool sendFront();
    void failed();
};

}  // namespace melophos
