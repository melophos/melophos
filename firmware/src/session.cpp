#include "session.h"

#include <Arduino.h>

namespace melophos {

void SessionRecorder::record(const NoteEvent &event) {
    if (event.velocity == 0) {
        return;  // count presses, not releases
    }
    if (!active_) {
        active_ = true;
        startedMs_ = event.timeMs;
        notesPlayed_ = 0;
        Serial.println("session: started");
    }
    lastNoteMs_ = event.timeMs;
    notesPlayed_++;
}

void SessionRecorder::tick(uint32_t nowMs) {
    if (active_ && nowMs - lastNoteMs_ > kIdleGapMs) {
        active_ = false;
        Serial.printf("session: ended after %lu ms, %lu notes\n", (unsigned long)(lastNoteMs_ - startedMs_),
                      (unsigned long)notesPlayed_);
        // publishing the finished session over MQTT lands with the network milestone
    }
}

}  // namespace melophos
