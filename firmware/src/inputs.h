#pragma once

#include "notebus.h"

namespace melophos {

// Every note source feeds the same bus. Sources that are not wired up yet
// report themselves as unavailable so the status topic shows what is live.
struct InputStatus {
    bool usbMidi;
    bool bleMidi;
    bool midiJack;
    bool audio;
};

void beginInputs(NoteBus &bus);
void pollInputs();
InputStatus inputStatus();

}  // namespace melophos
