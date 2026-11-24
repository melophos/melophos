#pragma once

#include <stdint.h>

#include "hal.h"

namespace melophos {

// the rotary encoder: two phases (A and B) and a push switch. Both are pure decoders, fed by whoever reads the
// pins, so they are host tested. Nothing in the firmware reacts to them yet: they only produce events. Awaits a
// board.
//
// QuadratureDecoder: full quadrature with detents. At rest both phases are high (pull-ups). One detent is a
// full cycle of four single-bit changes in the same direction ending back at rest:
//   clockwise          11 -> 10 -> 00 -> 01 -> 11
//   counter-clockwise  11 -> 01 -> 00 -> 10 -> 11
// A count is made only when a whole cycle ends at rest. Nothing is counted for
//   - bounce: a change that goes back before the detent (11 -> 10 -> 11 or 10 -> 00 -> 10 on the way)
//   - an illegal transition, where both phases change at once (11 -> 00, 10 -> 01): the sample was missed or
//     is noise, so the cycle in progress is abandoned and nothing counts until the encoder is next at rest
//   - a half turn that comes back
//   - the first sample: it is only the starting state. If the encoder is not at rest when the hub starts, nothing
//     counts until rest has been seen once
class QuadratureDecoder {
   public:
    // a sample of both phases (true is high). Returns +1 for a clockwise detent, -1 for counter-clockwise and 0
    int feed(bool a, bool b);
    // true while a cycle was abandoned and the decoder is waiting for rest
    bool lost() const { return lost_; }
    uint32_t illegal() const { return illegal_; }

   private:
    bool started_ = false;
    uint8_t last_ = 3;  // both high
    int8_t progress_ = 0;
    bool lost_ = false;
    uint32_t illegal_ = 0;
};

enum class SwitchEvent : uint8_t { None, Press, LongPress };

// what the encoder tells whoever reads it
struct EncoderEvent {
    enum Kind : uint8_t { Turn, Press, LongPress } kind;
    int8_t delta;  // +1 clockwise, -1 counter-clockwise, for Turn
};

// a short queue of events between the task that reads the pins and whoever reads the events. With no reader it
// must not keep the first events after boot for ever: when full the OLDEST is dropped (and counted). A reader
// that attaches late calls clear() to start from now
class EncoderEvents {
   public:
    static const size_t kCapacity = 16;
    explicit EncoderEvents(Lock *lock = nullptr) : lock_(lock ? lock : &none_) {}
    void push(const EncoderEvent &e);
    bool pop(EncoderEvent &out);
    void clear();
    uint32_t dropped() const { return dropped_; }
    size_t size() const { return count_; }

   private:
    Lock none_;
    Lock *lock_;
    EncoderEvent ring_[kCapacity];
    size_t head_ = 0, count_ = 0;
    uint32_t dropped_ = 0;
};

// DebouncedSwitch: a level is believed only after it has held for kDebounceMs. A short press is reported as
// Press when it is released (so a long press does not also give a Press). A press held for kLongMs is
// reported once as LongPress while it is still down and its release reports nothing. A switch that is down
// at power-up (held or stuck low) gives no Press and no LongPress until it has been seen released. active is the level
// that means pressed (low for this switch).
class DebouncedSwitch {
   public:
    static const uint32_t kDebounceMs = 20;
    static const uint32_t kLongMs = 800;
    explicit DebouncedSwitch(bool activeLow = true) : activeLow_(activeLow) {}
    // the raw pin level and the time. Call at least every few milliseconds
    SwitchEvent feed(bool level, uint32_t nowMs);
    bool pressed() const { return stable_; }

   private:
    bool activeLow_;
    bool raw_ = false;      // the last raw reading, as "pressed"
    uint32_t rawSince_ = 0;
    bool stable_ = false;   // the believed state, as "pressed"
    uint32_t pressedAt_ = 0;
    bool longSent_ = false;
    bool started_ = false;
    bool ignoring_ = false;  // down at start-up: reports nothing until released
};

}  // namespace melophos
