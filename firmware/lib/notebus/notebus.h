#pragma once

#include <stddef.h>
#include <stdint.h>

namespace melophos {

enum class NoteSource : uint8_t { UsbMidi, BleMidi, MidiJack, Audio, Network };

struct NoteEvent {
    uint32_t timeMs;
    uint8_t note;
    uint8_t velocity;  // 0 means note off, matching the MIDI running-status convention
    uint8_t channel;
    NoteSource source;
};

// fixed-size single-producer, single-consumer ring buffer. Inputs push from
// their own tasks and the render loop drains it, so no heap allocation ever
// happens on the note path.
class NoteBus {
   public:
    static const size_t kCapacity = 256;

    bool push(const NoteEvent &event);
    bool pop(NoteEvent &out);
    size_t size() const;
    uint32_t dropped() const { return dropped_; }

   private:
    NoteEvent buffer_[kCapacity];
    volatile size_t head_ = 0;
    volatile size_t tail_ = 0;
    uint32_t dropped_ = 0;
};

// which guide notes a host such as Synthesia wants lit. A plain bit set: a
// note is 0 to 127 so no index can go out of range.
class GuideSet {
   public:
    void set(uint8_t note, bool on) {
        if (note < 128) {
            if (on) {
                bits_[note >> 3] |= (uint8_t)(1u << (note & 7));
            } else {
                bits_[note >> 3] &= (uint8_t)~(1u << (note & 7));
            }
        }
    }
    bool test(uint8_t note) const { return note < 128 && (bits_[note >> 3] >> (note & 7)) & 1; }
    void clear() {
        for (auto &b : bits_) {
            b = 0;
        }
    }

   private:
    uint8_t bits_[16] = {};
};

}  // namespace melophos
