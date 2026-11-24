#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "identity.h"
#include "mqttlink.h"
#include "pairing.h"
#include "recordpair.h"

namespace melophos {

// the board side of the network task: radio, serial messages and the objects it builds. The real one
// is src/network_esp.cpp. The decisions (when to pair, when to connect, when to give up) are in
// NetworkController and run unchanged in the host tests.
class NetPlatform {
   public:
    virtual ~NetPlatform() {}
    virtual void say(const char *line) = 0;
    // builds the MQTT link for this identity (TLS or the development path as storage says). One owner:
    // only the controller ever holds or frees it
    virtual MqttLink *openLink(const char *host, uint16_t port, const char *id, const char *secret, uint32_t boot,
                               BootCommit *commit) = 0;
    virtual void closeLink(MqttLink *link) = 0;
    // a copy of the status the main loop last set, taken under the lock that guards it
    virtual StatusInfo status() = 0;
};

// one task, one owner. Decides, in this order, on every pass:
//   no identity            ask the server for one (pairing) and show its code. Never touches the broker
//   identity, not paired   keep polling GET /api/v1/device until the server says paired: true
//   paired                 learn claimed_by and last_boot once, then (and only then) connect to the broker
//   broker refuses twice   the hub was removed or un-claimed: forget the identity and pair again
// A boot counter that was lost or that is out of the server's range, stops publication and says
// why, with the recovery steps, once a minute.
class NetworkController : public BootCommit {
   public:
    NetworkController(Clock &clock, IdentityStore &identity, PairingFsm &pairing, NetPlatform &platform, DurableCounter &counter)
        : clock_(clock), identity_(identity), pairing_(pairing), platform_(platform), counter_(counter) {}
    // the link belongs to this controller, so it goes back to the platform when the controller does
    ~NetworkController() { closeLink(); }
    NetworkController(const NetworkController &) = delete;
    NetworkController &operator=(const NetworkController &) = delete;

    // call once at power-up. Reads the counter and writes nothing
    void begin();
    void step(bool wifiUp);
    void requestUnclaim() { unclaim_ = true; }
    // the person's request to drop sessions held for a date the server would skip. Done by the network task
    void requestClearStale() { clearStale_ = true; }
    bool everConnected() const { return everConnected_; }
    bool bootLost() const { return bootLost_; }
    bool bootOutOfRange() const { return outOfRange_; }
    uint32_t bootNumber() const { return boot_; }
    bool configured() const { return ready_; }
    bool linkUp() const { return link_ != nullptr; }
    // BootCommit: stores the boot when the broker first accepts the hub
    bool commit(uint32_t boot) override { return commitBoot(counter_, boot); }

   private:
    Clock &clock_;
    IdentityStore &identity_;
    PairingFsm &pairing_;
    NetPlatform &platform_;
    DurableCounter &counter_;
    MqttLink *link_ = nullptr;
    uint32_t boot_ = 0;
    bool bootLost_ = false;
    bool outOfRange_ = false;
    bool ready_ = false;
    bool readyKnown_ = false;
    uint32_t readyAtMs_ = 0;
    bool started_ = false;
    bool claimShown_ = false;
    bool wasUp_ = false;
    volatile bool clearStale_ = false;
    volatile bool unclaim_ = false;  // set by the main loop, read by the network task
    bool everConnected_ = false;
    uint32_t lastCodeMs_ = 0;
    uint32_t lastWarnMs_ = 0;
    bool codeShown_ = false;
    bool warned_ = false;

    void showCode();
    void closeLink();
    void warn(const char *text);
};

}  // namespace melophos
