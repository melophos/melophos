#pragma once

#include "notebus.h"

namespace melophos {

// every note source feeds the same bus. Sources that are not wired up yet
// report themselves as unavailable so the status topic shows what is live.
struct InputStatus {
    bool usbMidi;
    bool bleMidi;
    bool midiJack;
    bool audio;
};

void beginInputs(NoteBus &bus);
void pollInputs();
// false while the DC inlet is absent: the keyboard port stays off
void setHostPower(bool allowed);
InputStatus inputStatus();

}  // namespace melophos
