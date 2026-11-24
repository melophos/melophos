#pragma once

#include <stddef.h>
#include <stdint.h>

#include "notebus.h"

namespace melophos {

// where parsed notes go. The bus for keyboards, the guide lights for a host
// such as Synthesia.
class MidiSink {
   public:
    virtual ~MidiSink() {}
    virtual void note(const NoteEvent &event) = 0;
    virtual void allNotesOff(uint8_t channel) { (void)channel; }
};

class BusSink : public MidiSink {
   public:
    explicit BusSink(NoteBus &bus) : bus_(bus) {}
    void note(const NoteEvent &event) override { bus_.push(event); }

   private:
    NoteBus &bus_;
};

struct MidiStats {
    uint32_t notes;        // note events delivered
    uint32_t malformed;    // data without a status, messages cut short, sysex cut short
    uint32_t sysexBytes;   // bytes skipped inside system exclusive
};

// byte-at-a-time MIDI 1.0 reader for the jack and for Bluetooth. Nothing is
// buffered beyond two data bytes, so a flood cannot grow memory and every
// byte costs the same.
//   running status        data bytes repeat the last channel status
//   real-time bytes       0xF8 and above are acted on alone, even mid-message
//   truncated messages    a new status byte or a 500 ms gap drops the partial one
//   sysex without an end  skipped until any other status byte or a 500 ms gap
class MidiParser {
   public:
    static const uint32_t kStallMs = 500;

    explicit MidiParser(NoteSource source) : source_(source) {}
    // true when this byte finished a message or stood alone, so framing
    // layers such as Bluetooth know a timestamp comes next
    bool feed(uint8_t byte, uint32_t nowMs, MidiSink &sink);
    void reset();
    const MidiStats &stats() const { return stats_; }
    bool atBoundary() const;
    bool inSysex() const { return sysex_; }

   private:
    NoteSource source_;
    MidiStats stats_{};
    uint8_t status_ = 0;     // running status, 0 when none
    uint8_t data_[2] = {0, 0};
    uint8_t count_ = 0;
    bool fresh_ = false;     // a status byte arrived and no data has followed yet
    bool sysex_ = false;
    uint32_t lastMs_ = 0;
    bool seen_ = false;
};

// USB-MIDI 1.0 event packets: four bytes, cable and code index first.
class UsbMidiParser {
   public:
    UsbMidiParser() {}
    // a whole bulk transfer. A tail shorter than one packet is dropped and counted
    void feedTransfer(const uint8_t *data, size_t length, uint32_t nowMs, MidiSink &sink);
    const MidiStats &stats() const { return stats_; }

   private:
    MidiStats stats_{};
};

// Bluetooth MIDI: one packet is a header byte then timestamped messages.
class BleMidiParser {
   public:
    BleMidiParser() : inner_(NoteSource::BleMidi) {}
    void feedPacket(const uint8_t *data, size_t length, uint32_t nowMs, MidiSink &sink);
    void reset() { inner_.reset(); }
    const MidiStats &stats() const { return inner_.stats(); }
    uint32_t badPackets() const { return badPackets_; }

   private:
    MidiParser inner_;
    uint32_t badPackets_ = 0;
};

// encodes a note as one Bluetooth MIDI packet (header, timestamp, three bytes).
// Returns 5 or 0 for a note or channel out of range.
size_t encodeBleNote(const NoteEvent &event, uint8_t out[5]);

}  // namespace melophos
