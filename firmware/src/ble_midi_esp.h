#pragma once

#include "blemidi.h"
#include "notebus.h"

namespace melophos {

// Bluetooth MIDI on NimBLE. The hub advertises the standard MIDI service so
// macOS, Windows and Synthesia see it as a MIDI device.
//
// Compiles for both boards. It has never run on one: see docs/bluetooth-midi.md
// for the bring-up checklist (pairing, timing and range are all untested).
class BleMidiService {
   public:
    void begin(GuideSet &guides);
    // call every loop pass: applies radio events and sends queued notes
    void poll();
    // a note the player pressed, sent back to the host as MIDI input
    void sendPlayed(const NoteEvent &event);
    bool connected() const;
    // lets one new device bond for two minutes. A deliberate act: the serial command `ble pair` now, the button later
    void openPairing();
    // the owner confirms the device that is waiting: `ble accept` on serial now, the button later
    void acceptWaiting();
};

}  // namespace melophos
