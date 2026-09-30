#pragma once

#include <stdint.h>

#include "notebus.h"

namespace melophos {

// Groups note events into practice sessions. A session starts on the first
// note and ends after a quiet gap, so the hub never needs a start button.
class SessionRecorder {
   public:
    static const uint32_t kIdleGapMs = 120000;

    void record(const NoteEvent &event);
    void tick(uint32_t nowMs);
    bool active() const { return active_; }
    uint32_t notesPlayed() const { return notesPlayed_; }

   private:
    bool active_ = false;
    uint32_t startedMs_ = 0;
    uint32_t lastNoteMs_ = 0;
    uint32_t notesPlayed_ = 0;
};

}  // namespace melophos
