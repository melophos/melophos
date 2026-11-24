#pragma once

#include "hal.h"
#include "notebus.h"
#include "publish.h"

namespace melophos {

// Wi-Fi, the clock, pairing and the MQTT link, on a task of their own so a slow
// connect never stalls the LEDs. Everything the hub needs to know about the
// network comes from storage that the owner provisions (see lib/identity):
// nothing is compiled in. Until a hub is provisioned the whole thing idles.
//
// Compiles for both boards. It has never run on one: see docs/mqtt.md.
class Network {
   public:
    // reads and raises the boot counter (a lost one stops publishing, see lib/recordpair), restores the
    // last session and starts the network task
    void begin(NoteBus &bus, Flash &stateFlash, Flash &outboxFlash);
    // loop thread: dates and batches sessions and clears the saved copy once delivered
    void poll();
    void onNote(const NoteEvent &event);
    void setContext(const char *profileId, const char *mode, const StatusInfo &inputs);
    // one provisioning line, for example "wifi HomeNet password". Returns whether it worked
    bool provision(const char *line, size_t length, char *reply, size_t cap);
    // forget the Wi-Fi, broker, device identity and certificate authority
    void forgetEverything();
    // the same, with the profiles and the saved last session. False if a sector would not erase
    bool factoryReset(Flash &profiles, Flash &outbox);
    // the hub has what it needs to connect: Wi-Fi, a broker, an identity and a certificate authority
    bool configured();
    bool everConnected() const;
    // the boot counter was lost: the hub does not publish until the owner re-pairs it
    bool bootLost() const;
    // the power adapter's rating (5000 unless the owner set another with `provision supply`)
    uint16_t supplyMa();
    // undo a claim by someone else (within 15 minutes of the claim)
    void unclaim();
    // `queue clear-stale`: drop held sessions whose date the server would skip (nothing else ever does)
    void clearStale();
    // true while the hub is allowed to use plain MQTT: show it
    bool insecure();
    // the stored sound setting for the buzzer: off unless turned on
    // the third LED output: the length in use (stored, default 60) and the hard maximum the hub supports
    uint16_t auxLength();
    bool setAuxLength(uint16_t length, const char **why);
    bool soundOn();
    // true when the write to flash succeeded and reads back
    bool setSoundOn(bool on);
    // the pairing code while the owner has to type it, else empty
    const char *pairingCode() const;
};

}  // namespace melophos
