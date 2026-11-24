#include "encoder.h"

namespace melophos {

int QuadratureDecoder::feed(bool a, bool b) {
    uint8_t code = (uint8_t)((a ? 2 : 0) | (b ? 1 : 0));
    if (!started_) {
        // the first sample is only where the encoder is. Away from rest, nothing counts until rest is seen
        started_ = true;
        last_ = code;
        lost_ = code != 3;
        return 0;
    }
    if (code == last_) {
        return 0;
    }
    uint8_t diff = (uint8_t)(code ^ last_);
    if (diff == 3) {
        // both phases changed at once: not a legal step
        illegal_++;
        progress_ = 0;
        lost_ = code != 3;
        last_ = code;
        return 0;
    }
    // the clockwise order of the codes is 3, 2, 0, 1, 3
    static const int8_t next[4] = {1, 3, 0, 2};  // the code after each one going clockwise: 0->1, 1->3, 2->0, 3->2
    int8_t step = next[last_] == code ? 1 : -1;
    last_ = code;
    if (lost_) {
        if (code == 3) {
            lost_ = false;  // back at rest: counting starts again
        }
        progress_ = 0;
        return 0;
    }
    progress_ = (int8_t)(progress_ + step);
    if (code == 3) {
        int8_t done = progress_;
        progress_ = 0;
        if (done == 4) {
            return 1;
        }
        if (done == -4) {
            return -1;
        }
        return 0;  // back at rest without a whole cycle: bounce
    }
    if (progress_ > 4 || progress_ < -4) {
        progress_ = 0;
        lost_ = true;  // wandered further than one cycle without resting: noise
    }
    return 0;
}

SwitchEvent DebouncedSwitch::feed(bool level, uint32_t nowMs) {
    bool pressed = activeLow_ ? !level : level;
    if (!started_) {
        started_ = true;
        raw_ = pressed;
        rawSince_ = nowMs;
        stable_ = false;
        ignoring_ = pressed;  // down at start-up: held or stuck. No press and no long press until it is released
        if (!pressed) {
            return SwitchEvent::None;
        }
    }
    if (pressed != raw_) {
        raw_ = pressed;
        rawSince_ = nowMs;
    }
    if (ignoring_ && !stable_ && !raw_ && (uint32_t)(nowMs - rawSince_) >= kDebounceMs) {
        ignoring_ = false;  // the released state is now debounced, so a start-up glitch that went away is over
    }
    if (raw_ != stable_ && (uint32_t)(nowMs - rawSince_) >= kDebounceMs) {
        stable_ = raw_;
        if (stable_) {
            pressedAt_ = nowMs;
            longSent_ = ignoring_;  // a press that began at start-up never reports a long press
            return SwitchEvent::None;
        }
        bool wasIgnored = ignoring_;
        ignoring_ = false;  // seen released: from now on presses count
        if (!longSent_ && !wasIgnored) {
            return SwitchEvent::Press;  // released before the long press time
        }
        return SwitchEvent::None;
    }
    if (stable_ && !longSent_ && (uint32_t)(nowMs - pressedAt_) >= kLongMs) {
        longSent_ = true;
        return SwitchEvent::LongPress;
    }
    return SwitchEvent::None;
}

void EncoderEvents::push(const EncoderEvent &e) {
    LockGuard g(*lock_);
    if (count_ == kCapacity) {
        head_ = (head_ + 1) % kCapacity;  // drop the oldest
        count_--;
        dropped_++;
    }
    ring_[(head_ + count_) % kCapacity] = e;
    count_++;
}

bool EncoderEvents::pop(EncoderEvent &out) {
    LockGuard g(*lock_);
    if (count_ == 0) {
        return false;
    }
    out = ring_[head_];
    head_ = (head_ + 1) % kCapacity;
    count_--;
    return true;
}

void EncoderEvents::clear() {
    LockGuard g(*lock_);
    head_ = 0;
    count_ = 0;
}

}  // namespace melophos
