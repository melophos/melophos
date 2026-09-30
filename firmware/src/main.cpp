#include <Arduino.h>

#include "inputs.h"
#include "keymap.h"
#include "leds.h"
#include "melophos_config.h"
#include "notebus.h"
#include "session.h"

using namespace melophos;

namespace {

// Default profile until profiles are loaded from flash: piano-88 from
// profiles/piano-88.json, one LED per key.
const KeyboardProfile kDefaultProfile{21, 108, 23.5f, LedLayout::PerKey, 0.0f, 0, false};

NoteBus noteBus;
Leds leds;
SessionRecorder session;

}  // namespace

void setup() {
    Serial.begin(115200);
    Serial.printf("MELOPHOS hub firmware %s\n", MELOPHOS_FIRMWARE_VERSION);
    leds.begin(kDefaultProfile);
    beginInputs(noteBus);
}

void loop() {
    pollInputs();

    NoteEvent event;
    bool changed = false;
    while (noteBus.pop(event)) {
        leds.setNote(event.note, LightRole::Played, event.velocity > 0);
        session.record(event);
        changed = true;
    }
    if (changed) {
        leds.show();
    }
    session.tick(millis());
}
