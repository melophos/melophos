#include "inputs.h"

#include <Arduino.h>

#include "melophos_config.h"

namespace melophos {

namespace {

NoteBus *noteBus = nullptr;
InputStatus status{false, false, false, false};

// MIDI over the 3.5 mm TRS jack is plain 31250 baud serial, so it is the one
// input that works today without extra libraries.
uint8_t runningStatus = 0;
uint8_t pending[2];
uint8_t pendingCount = 0;

void handleMidiByte(uint8_t byte) {
    if (byte >= 0xF8) {
        return;  // real-time messages (clock, active sensing) never carry notes
    }
    if (byte & 0x80) {
        runningStatus = byte;
        pendingCount = 0;
        return;
    }
    uint8_t type = runningStatus & 0xF0;
    if (type != 0x80 && type != 0x90) {
        return;
    }
    pending[pendingCount++] = byte;
    if (pendingCount < 2) {
        return;
    }
    pendingCount = 0;
    uint8_t velocity = (type == 0x80) ? 0 : pending[1];
    NoteEvent event{millis(), pending[0], velocity, (uint8_t)(runningStatus & 0x0F), NoteSource::MidiJack};
    noteBus->push(event);
}

}  // namespace

void beginInputs(NoteBus &bus) {
    noteBus = &bus;
    Serial1.begin(31250, SERIAL_8N1, PIN_MIDI_RX, PIN_MIDI_TX);
    status.midiJack = true;
    // USB-MIDI host (TinyUSB), BLE-MIDI (NimBLE) and I2S audio arrive in the
    // v1 milestones listed in docs/roadmap.md.
}

void pollInputs() {
    while (Serial1.available() > 0) {
        handleMidiByte((uint8_t)Serial1.read());
    }
}

InputStatus inputStatus() {
    return status;
}

}  // namespace melophos
