#pragma once

#include "notebus.h"

namespace melophos {

// USB-MIDI host on the ESP32-S3: powers the keyboard, enumerates it and feeds
// its notes to the bus. Only the ESP32-S3 has a USB host. On other boards
// begin() does nothing and available() stays false.
//
// Compiles for the board. It has never run on one: see docs/usb-midi.md for
// the bring-up checklist.
class UsbMidiHost {
   public:
    void begin(NoteBus &bus);
    // call every loop pass: runs the state machine and drains received packets
    void poll();
    bool available() const;
    // false while the DC inlet is absent: the keyboard port stays off
    void setPowerAllowed(bool allowed);
};

}  // namespace melophos
