#include "inputs.h"

#include <Arduino.h>

#include "melophos_config.h"
#include "midi.h"
#include "usb_host_esp.h"

namespace melophos {

namespace {

NoteBus *noteBus = nullptr;
InputStatus status{false, false, false, false};

// MIDI over the 3.5 mm TRS jack is plain 31250 baud serial. The parser is
// shared with Bluetooth and is tested on the host
MidiParser jackParser(NoteSource::MidiJack);
UsbMidiHost usbHost;

}  // namespace

void beginInputs(NoteBus &bus) {
    noteBus = &bus;
    Serial1.begin(31250, SERIAL_8N1, PIN_MIDI_RX, PIN_MIDI_TX);
    status.midiJack = true;
    usbHost.begin(bus);
    // BLE-MIDI (NimBLE) and I2S audio arrive in the v1 milestones listed in
    // docs/roadmap.md.
}

void pollInputs() {
    BusSink sink(*noteBus);
    while (Serial1.available() > 0) {
        jackParser.feed((uint8_t)Serial1.read(), millis(), sink);
    }
    usbHost.poll();
    status.usbMidi = usbHost.available();
}

void setHostPower(bool allowed) {
    usbHost.setPowerAllowed(allowed);
}

InputStatus inputStatus() {
    return status;
}

}  // namespace melophos
