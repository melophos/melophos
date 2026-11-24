#include "midi.h"

namespace melophos {

namespace {

// data bytes a channel status needs, 0 for those the hub ignores anyway
uint8_t dataBytes(uint8_t status) {
    uint8_t type = status & 0xF0;
    return (type == 0xC0 || type == 0xD0) ? 1 : 2;
}

}  // namespace

void MidiParser::reset() {
    status_ = 0;
    count_ = 0;
    fresh_ = false;
    sysex_ = false;
}

bool MidiParser::atBoundary() const {
    return !sysex_ && count_ == 0 && !fresh_;
}

bool MidiParser::feed(uint8_t byte, uint32_t nowMs, MidiSink &sink) {
    // a half-finished message or an open sysex that goes quiet is abandoned,
    // otherwise a cable pulled mid-message would swallow the next notes
    if (seen_ && (int32_t)(nowMs - lastMs_) > (int32_t)kStallMs && (count_ > 0 || sysex_)) {
        stats_.malformed++;
        count_ = 0;
        sysex_ = false;
    }
    seen_ = true;
    lastMs_ = nowMs;

    if (byte >= 0xF8) {
        return true;  // clock, active sensing and the like: no effect on any state
    }
    if (byte & 0x80) {
        if (count_ > 0 || sysex_ ) {
            if (!(sysex_ && byte == 0xF7)) {
                stats_.malformed++;  // cut short by the next status
            }
        }
        count_ = 0;
        fresh_ = false;
        if (byte == 0xF0) {
            sysex_ = true;
            status_ = 0;
            return false;
        }
        sysex_ = false;
        if (byte >= 0xF0) {
            status_ = 0;  // system common cancels running status
            return true;  // F7 alone, F1 to F6: nothing the hub uses
        }
        status_ = byte;
        fresh_ = true;
        return false;
    }
    // data byte
    if (sysex_) {
        stats_.sysexBytes++;
        return false;
    }
    if (status_ == 0) {
        stats_.malformed++;
        return false;
    }
    data_[count_++] = byte;
    if (count_ < dataBytes(status_)) {
        return false;
    }
    count_ = 0;
    fresh_ = false;
    uint8_t type = status_ & 0xF0;
    uint8_t channel = status_ & 0x0F;
    if (type == 0x80 || type == 0x90) {
        uint8_t velocity = type == 0x80 ? 0 : data_[1];
        stats_.notes++;
        sink.note(NoteEvent{nowMs, data_[0], velocity, channel, source_});
    } else if (type == 0xB0 && (data_[0] == 123 || data_[0] == 120)) {
        sink.allNotesOff(channel);
    }
    return true;
}

void UsbMidiParser::feedTransfer(const uint8_t *data, size_t length, uint32_t nowMs, MidiSink &sink) {
    if (data == nullptr) {
        return;
    }
    size_t whole = length & ~(size_t)3;
    if (whole != length) {
        stats_.malformed++;
    }
    for (size_t i = 0; i < whole; i += 4) {
        uint8_t cin = data[i] & 0x0F;
        const uint8_t *m = data + i + 1;
        if (cin != 0x8 && cin != 0x9 && cin != 0xB) {
            continue;  // padding, sysex, program change and the rest carry no notes
        }
        if ((m[0] & 0x80) == 0 || (m[1] & 0x80) || (m[2] & 0x80)) {
            stats_.malformed++;  // a status byte must lead and the data bytes must be 7 bit
            continue;
        }
        uint8_t type = m[0] & 0xF0;
        if (type != (uint8_t)(cin << 4)) {
            stats_.malformed++;  // the code index disagrees with the status byte
            continue;
        }
        uint8_t channel = m[0] & 0x0F;
        if (type == 0xB0) {
            if (m[1] == 123 || m[1] == 120) {
                sink.allNotesOff(channel);
            }
            continue;
        }
        stats_.notes++;
        sink.note(NoteEvent{nowMs, m[1], type == 0x80 ? (uint8_t)0 : m[2], channel, NoteSource::UsbMidi});
    }
}

void BleMidiParser::feedPacket(const uint8_t *data, size_t length, uint32_t nowMs, MidiSink &sink) {
    if (data == nullptr || length < 3 || (data[0] & 0xC0) != 0x80) {
        badPackets_++;  // the header has bit 7 set and bit 6 clear
        return;
    }
    bool expectTimestamp = true;
    for (size_t i = 1; i < length; i++) {
        uint8_t b = data[i];
        if (inner_.inSysex() && (b & 0x80) && b != 0xF7) {
            continue;  // the timestamp byte that precedes the end of a sysex
        }
        // a real-time byte may sit inside a message with a timestamp byte of its own in front of it
        if (!inner_.atBoundary() && (b & 0x80) && b < 0xF8 && i + 1 < length && data[i + 1] >= 0xF8) {
            continue;
        }
        if (expectTimestamp && inner_.atBoundary()) {
            if (!(b & 0x80)) {
                badPackets_++;  // a message without a timestamp byte
                continue;
            }
            expectTimestamp = false;
            continue;
        }
        if (inner_.feed(b, nowMs, sink)) {
            expectTimestamp = true;
        }
    }
}

size_t encodeBleNote(const NoteEvent &event, uint8_t out[5]) {
    if (event.note > 127 || event.velocity > 127 || event.channel > 15) {
        return 0;
    }
    uint16_t ts = (uint16_t)(event.timeMs & 0x1FFF);
    out[0] = (uint8_t)(0x80 | (ts >> 7));
    out[1] = (uint8_t)(0x80 | (ts & 0x7F));
    out[2] = (uint8_t)((event.velocity ? 0x90 : 0x80) | event.channel);
    out[3] = event.note;
    out[4] = event.velocity ? event.velocity : 64;  // a release velocity of 64 is the neutral value
    return 5;
}

}  // namespace melophos
