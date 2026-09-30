#include "notebus.h"

namespace melophos {

bool NoteBus::push(const NoteEvent &event) {
    size_t next = (head_ + 1) % kCapacity;
    if (next == tail_) {
        // dropping the newest event keeps already-lit notes consistent; the
        // counter shows up in the status topic so a busy input is visible
        dropped_++;
        return false;
    }
    buffer_[head_] = event;
    head_ = next;
    return true;
}

bool NoteBus::pop(NoteEvent &out) {
    if (tail_ == head_) {
        return false;
    }
    out = buffer_[tail_];
    tail_ = (tail_ + 1) % kCapacity;
    return true;
}

size_t NoteBus::size() const {
    return (head_ + kCapacity - tail_) % kCapacity;
}

}  // namespace melophos
