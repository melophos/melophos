#pragma once

#include <string.h>

#include <stddef.h>
#include <stdint.h>

#include "midi.h"
#include "notebus.h"

namespace melophos {

// the radio side of Bluetooth MIDI. The real one is NimBLE: the standard
// service 03B80E5A-EDE8-4B33-A751-6CE34EC4C700 and its characteristic
// 7772E5DB-3868-4112-A1A9-F2669D106BF3.
class BlePort {
   public:
    virtual ~BlePort() {}
    virtual void startAdvertising() = 0;
    // false when the stack could not take the packet (queue full, link gone)
    virtual bool notify(const uint8_t *data, size_t length) = 0;
};

// an identity address: 6 bytes and a type (0 public, 1 random)
struct PeerAddr {
    uint8_t bytes[6] = {0, 0, 0, 0, 0, 0};
    uint8_t type = 0;
    bool operator==(const PeerAddr &o) const { return type == o.type && memcmp(bytes, o.bytes, 6) == 0; }
    bool isZero() const {
        for (uint8_t b : bytes) {
            if (b != 0) {
                return false;
            }
        }
        return true;
    }
};

// the devices the owner has accepted, at most 4 (the oldest goes when a fifth is added). Stored as text
// "AABBCCDDEEFF/0 AABBCCDDEEFF/1": hex of the six bytes, a slash and the type.
class AcceptedPeers {
   public:
    static const size_t kMax = 4;
    static const size_t kTextMax = kMax * 16 + 1;
    bool contains(const PeerAddr &a) const {
        for (size_t i = 0; i < n_; i++) {
            if (list_[i] == a) {
                return true;
            }
        }
        return false;
    }
    bool add(const PeerAddr &a);
    size_t count() const { return n_; }
    void toText(char *out, size_t cap) const;
    // false when the text is not a list: the list is then left empty
    bool fromText(const char *text);

   private:
    PeerAddr list_[kMax];
    size_t n_ = 0;
};

// who may talk to the hub over Bluetooth. A guide light written by a stranger's phone would be a
// way to flash the bar, so writes are accepted only on an encrypted, bonded link and a new
// device can bond only while pairing has been opened on purpose (serial command `ble pair` now,
// the button once the board has one) for a short window.
class PairingWindow {
   public:
    static const uint32_t kOpenMs = 120000;
    void open(uint32_t nowMs) {
        until_ = nowMs + kOpenMs;
        isOpen_ = true;
    }
    bool allowed(uint32_t nowMs) const { return isOpen_ && (int32_t)(until_ - nowMs) > 0; }
    void close() { isOpen_ = false; }

   private:
    uint32_t until_ = 0;
    bool isOpen_ = false;
};

// connection state and both directions of the data:
//   in   the host's note-on and note-off drive GuideSet (guide lights, never
//        counted as played notes). All notes off, a disconnect and a new
//        connection clear it so a lost note-off cannot leave a light stuck.
//   out  played notes go back to the host as MIDI input, at most 8 queued
//        (oldest dropped and counted), one packet per notification.
class BleMidiLink : public MidiSink {
   public:
    static const size_t kOutQueue = 8;
    static const size_t kMaxPacketNotes = 3;  // 3 x 5 bytes fits a 20 byte payload at the default MTU of 23

    BleMidiLink(BlePort &port, GuideSet &guides) : port_(port), guides_(guides) {}

    void begin() { port_.startAdvertising(); }
    // a central connected. False means refuse it: it is not bonded and pairing is not open
    bool acceptConnection(bool bonded, uint32_t nowMs);
    void openPairing(uint32_t nowMs) { window_.open(nowMs); }
    // the link became encrypted (bonded). Until then nothing a peer writes counts
    void onEncrypted(bool encrypted) { encrypted_ = encrypted; }
    bool encrypted() const { return encrypted_; }
    // ---- peers. The Bluetooth stack stores a bond as soon as a device pairs, before the owner has said yes and
    // keeps it across restarts. So "the stack says it is bonded" proves nothing here. The hub keeps its OWN
    // list of accepted devices by identity address (the address the bond resolves to, which is the same for a
    // phone that changes its random address). A device not on the list is never trusted, on any connection:
    //   Trusted   on the list
    //   Waiting   not on the list, the pairing window is open and nobody else is waiting. None of its writes
    //             is applied or queued until the owner confirms it (`ble accept` on serial, the button later)
    //   Refused   anything else
    // The disconnect of a waiting or refused device never touches the trusted host's link or lights and its
    // bond is deleted at once (takeBondToDelete), as is any bond found at start-up that is not on the list
    enum class Peer : uint8_t { Refused, Waiting, Trusted };
    Peer onPeerConnect(uint16_t handle, const PeerAddr &addr, uint32_t nowMs);
    void onPeerEncrypted(uint16_t handle);
    // once pairing finishes the stack knows the device's identity address, which can differ from the address it
    // connected with (a phone's random address). The waiting device is then known by that one
    void onPeerIdentity(uint16_t handle, const PeerAddr &addr);
    void onPeerReceive(uint16_t handle, const uint8_t *data, size_t length, uint32_t nowMs);
    void onPeerDisconnect(uint16_t handle);
    // the owner confirms the device that is waiting. False when none is
    bool acceptWaiting();
    uint16_t waitingHandle() const { return waiting_; }
    uint16_t trustedHandle() const { return trusted_; }
    // drops a waiting device whose window has closed. True when one was dropped
    bool expireWaiting(uint32_t nowMs);
    // at start-up: every bond the stack holds that is not on the list is queued for deletion
    void auditBonds(const PeerAddr *bonds, size_t count);
    // the next bond the glue must delete, false when none
    bool takeBondToDelete(PeerAddr &out);
    // the list, as text for storage. loadAccepted replaces the list from that text (false if it does not parse)
    AcceptedPeers &accepted() { return accepted_; }
    // true once after the list changed: the glue stores it
    bool takeAcceptedChanged() {
        bool c = acceptedChanged_;
        acceptedChanged_ = false;
        return c;
    }

    void onConnect();
    void onDisconnect();
    void onSubscribe(bool enabled) { subscribed_ = enabled; }
    void onReceive(const uint8_t *data, size_t length, uint32_t nowMs);
    // a note the player pressed
    void queueOut(const NoteEvent &event);
    // call once per loop: sends at most one packet
    void pump();

    bool connected() const { return connected_; }
    bool subscribed() const { return subscribed_; }
    uint32_t outDropped() const { return outDropped_; }
    const MidiStats &inStats() const { return parser_.stats(); }
    uint32_t badPackets() const { return parser_.badPackets(); }

    void note(const NoteEvent &event) override { guides_.set(event.note, event.velocity > 0); }
    void allNotesOff(uint8_t) override { guides_.clear(); }

   private:
    BlePort &port_;
    GuideSet &guides_;
    BleMidiParser parser_;
    bool connected_ = false;
    bool encrypted_ = false;
    AcceptedPeers accepted_;
    bool acceptedChanged_ = false;
    PeerAddr deleteQueue_[4];
    size_t deleteCount_ = 0;
    PeerAddr waitingAddr_;
    void queueDelete(const PeerAddr &a);
    uint16_t trusted_ = 0;
    uint16_t waiting_ = 0;
    bool waitingEncrypted_ = false;
    uint32_t waitingSinceMs_ = 0;
    PairingWindow window_;
    bool subscribed_ = false;
    NoteEvent out_[kOutQueue];
    size_t outCount_ = 0;
    uint32_t outDropped_ = 0;
};

}  // namespace melophos
