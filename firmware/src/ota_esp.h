#pragma once

#include "hal.h"

namespace melophos {

// Wi-Fi update glue. Compiled only when the build defines MELOPHOS_ENABLE_OTA
// (see melophos_config.h). Off by default: nothing here is in the shipped
// binary unless someone turns it on with real settings.
//
// Compiles for the board. It has never run on one: see docs/updates.md for
// what remains and the bring-up checklist.
class OtaService {
   public:
    // first thing in setup(): decides whether this boot is a trial
    void begin(Flash &stateFlash);
    // every loop pass. healthy is this pass's verdict for the trial
    void tick(uint32_t uptimeMs, bool healthy);
    // fetches, verifies and stages an update, then restarts into it. Returns the reason when it does not
    const char *checkNow(uint32_t runningVersion);
    bool enabled() const;
};

}  // namespace melophos
