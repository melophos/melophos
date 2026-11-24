#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "identity.h"
#include "publish.h"

namespace melophos {

struct HttpReply {
    int status;             // 0 when the request itself failed (no network, time-out, bad certificate)
    uint32_t retryAfterS;   // from a 429 answer
    char body[512];
    size_t length;
};

// HTTPS to the server with the certificate verified the same way as the broker's.
// The real one is src/tls_transport. Every call has a time-out of 10 s.
class HttpsPort {
   public:
    virtual ~HttpsPort() {}
    // POST /api/v1/pairing with no body
    virtual bool requestIdentity(HttpReply &out) = 0;
    // GET /api/v1/device with Authorization: Device <id>:<secret>
    virtual bool checkDevice(const char *id, const char *secret, HttpReply &out) = 0;
    // DELETE /api/v1/device/claim: undo a claim within 15 minutes. It removes the identity and its login
    virtual bool removeClaim(const char *id, const char *secret, HttpReply &out) = 0;
};

// the pairing flow from docs/protocol.md, as a state machine.
//   1  ask for an identity and write it to storage at once
//   2  show the code (the serial port today) for the owner to type into the Studio
//   3  poll every 3 s until paired
//   4  after expires_in seconds without it, forget the identity and start again
//      (at most 20 requests an hour and a 429 is obeyed)
//   5  a 401 later on means the hub was removed: forget the identity and pair again
// The hub connects to the broker only once the server has said paired: true, because the broker
// login is made at that answer. After a restart a hub that was not yet paired carries on polling and
// a hub that was paired goes straight to the broker. The answer names who claimed the hub
// (claimed_by, with most of the address hidden). The hub has no screen, so it reports that over
// serial and the Studio's device view. Anyone who reads the code off the hub can claim it, so the
// owner must check and unclaim() undoes a wrong claim within 15 minutes.
class PairingFsm {
   public:
    enum class State : uint8_t { NeedsPairing, Waiting, Paired, Backoff };
    static const uint32_t kPollMs = 3000;
    static const uint32_t kMaxRequestsPerHour = 20;
    // while paired the time is asked again every 15 minutes (one small request: a TLS handshake and about 1 KB,
    // under 100 a day) and at every reconnect. A failed check is retried after a minute
    static const uint32_t kTimeEveryMs = 15 * 60 * 1000;

    PairingFsm(Clock &clock, HttpsPort &http, IdentityStore &store, const WallClock &wall) : clock_(clock), http_(http), store_(store), wall_(wall) {}
    // decides the starting state from what storage holds
    void begin();
    void tick();
    void setTimeSink(ServerTimeSink *sink) { timeSink_ = sink; }
    // ask for the time at the next tick (a reconnect)
    void requestTimeCheck() { timeDue_ = true; }
    // the server said 401 on a later call
    void onUnauthorised();
    // undo a claim by someone else. True when the server accepted and the identity is gone
    bool unclaim();
    State state() const { return state_; }
    // the highest boot the server has seen from this hub (last_boot), -1 until it says
    int64_t lastBoot() const { return lastBoot_; }
    // true once the server has confirmed paired: true in this run, so claimed_by and last_boot are known
    bool refreshed() const { return refreshed_; }
    // who claimed this hub, empty until the server has said
    const char *claimedBy() const { return claimedBy_; }
    const char *undoUntil() const { return undoUntil_; }
    const char *code() const { return code_; }
    uint32_t requests() const { return requestsInHour_; }

   private:
    Clock &clock_;
    HttpsPort &http_;
    IdentityStore &store_;
    State state_ = State::NeedsPairing;
    char code_[16] = "";
    const WallClock &wall_;
    int64_t lastBoot_ = -1;
    ServerTimeSink *timeSink_ = nullptr;
    bool timeDue_ = false;
    uint32_t nextTimeMs_ = 0;
    void timeCheck();
    bool refreshed_ = false;
    bool windowLoaded_ = false;
    int64_t windowStart_ = 0;
    char claimedBy_[96] = "";
    char undoUntil_[40] = "";
    uint32_t expiresAtMs_ = 0;
    uint32_t nextActionMs_ = 0;
    uint32_t requestsInHour_ = 0;
    void request();
    void poll();
    void restart(uint32_t waitMs);
};

}  // namespace melophos
