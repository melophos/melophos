#include "blemidi.h"

#include <string.h>

namespace melophos {

bool BleMidiLink::acceptConnection(bool bonded, uint32_t nowMs) {
    return bonded || window_.allowed(nowMs);
}

bool AcceptedPeers::add(const PeerAddr &a) {
    if (a.isZero()) {
        return false;
    }
    if (contains(a)) {
        return true;
    }
    if (n_ == kMax) {
        for (size_t i = 1; i < kMax; i++) {
            list_[i - 1] = list_[i];
        }
        n_--;
    }
    list_[n_++] = a;
    return true;
}

void AcceptedPeers::toText(char *out, size_t cap) const {
    static const char *hex = "0123456789ABCDEF";
    size_t o = 0;
    for (size_t i = 0; i < n_ && o + 16 < cap; i++) {
        if (i > 0) {
            out[o++] = ' ';
        }
        for (int k = 0; k < 6; k++) {
            out[o++] = hex[list_[i].bytes[k] >> 4];
            out[o++] = hex[list_[i].bytes[k] & 15];
        }
        out[o++] = '/';
        out[o++] = (char)('0' + (list_[i].type & 1));
    }
    if (cap > 0) {
        out[o < cap ? o : cap - 1] = '\0';
    }
}

bool AcceptedPeers::fromText(const char *text) {
    n_ = 0;
    if (text == nullptr) {
        return false;
    }
    auto nib = [](char c) -> int {
        return c >= '0' && c <= '9' ? c - '0' : (c >= 'A' && c <= 'F' ? c - 'A' + 10 : (c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1));
    };
    const char *p = text;
    while (*p != '\0') {
        PeerAddr a;
        for (int k = 0; k < 6; k++) {
            int hi = nib(p[0]);
            int lo = hi < 0 ? -1 : nib(p[1]);
            if (hi < 0 || lo < 0) {
                n_ = 0;
                return false;
            }
            a.bytes[k] = (uint8_t)(hi * 16 + lo);
            p += 2;
        }
        if (p[0] != '/' || (p[1] != '0' && p[1] != '1')) {
            n_ = 0;
            return false;
        }
        a.type = (uint8_t)(p[1] - '0');
        p += 2;
        if (*p == ' ') {
            p++;
        } else if (*p != '\0') {
            n_ = 0;
            return false;
        }
        if (!add(a)) {
            n_ = 0;
            return false;
        }
    }
    return true;
}

void BleMidiLink::queueDelete(const PeerAddr &a) {
    if (a.isZero() || accepted_.contains(a)) {
        return;  // never delete the bond of an accepted device
    }
    for (size_t i = 0; i < deleteCount_; i++) {
        if (deleteQueue_[i] == a) {
            return;
        }
    }
    if (deleteCount_ < 4) {
        deleteQueue_[deleteCount_++] = a;
    }
}

bool BleMidiLink::takeBondToDelete(PeerAddr &out) {
    if (deleteCount_ == 0) {
        return false;
    }
    out = deleteQueue_[0];
    for (size_t i = 1; i < deleteCount_; i++) {
        deleteQueue_[i - 1] = deleteQueue_[i];
    }
    deleteCount_--;
    return true;
}

void BleMidiLink::auditBonds(const PeerAddr *bonds, size_t count) {
    for (size_t i = 0; i < count; i++) {
        queueDelete(bonds[i]);
    }
}

BleMidiLink::Peer BleMidiLink::onPeerConnect(uint16_t handle, const PeerAddr &addr, uint32_t nowMs) {
    if (handle == 0 || addr.isZero()) {
        return Peer::Refused;
    }
    if (accepted_.contains(addr)) {
        trusted_ = handle;
        onConnect();
        return Peer::Trusted;
    }
    // not on the list: whatever bond the stack holds for it is not to be kept
    if (window_.allowed(nowMs) && waiting_ == 0) {
        waiting_ = handle;
        waitingAddr_ = addr;
        waitingEncrypted_ = false;
        waitingSinceMs_ = nowMs;
        return Peer::Waiting;
    }
    queueDelete(addr);
    return Peer::Refused;
}

void BleMidiLink::onPeerEncrypted(uint16_t handle) {
    if (handle == trusted_) {
        onEncrypted(true);
    } else if (handle == waiting_) {
        waitingEncrypted_ = true;  // bonded but not confirmed: still nothing is applied
    }
}

void BleMidiLink::onPeerIdentity(uint16_t handle, const PeerAddr &addr) {
    if (handle != 0 && handle == waiting_ && !addr.isZero()) {
        waitingAddr_ = addr;
    }
}

void BleMidiLink::onPeerReceive(uint16_t handle, const uint8_t *data, size_t length, uint32_t nowMs) {
    if (handle == 0 || handle != trusted_) {
        return;  // from a waiting, refused or unknown device: dropped, not applied and not queued
    }
    onReceive(data, length, nowMs);
}

void BleMidiLink::onPeerDisconnect(uint16_t handle) {
    if (handle != 0 && handle == trusted_) {
        trusted_ = 0;
        onDisconnect();
    } else if (handle != 0 && handle == waiting_) {
        queueDelete(waitingAddr_);  // it left without being accepted: its bond goes at once
        waiting_ = 0;
        waitingEncrypted_ = false;
    }
    // a refused one was already queued for deletion when it connected. The real host's link is untouched
}

bool BleMidiLink::acceptWaiting() {
    if (waiting_ == 0) {
        return false;
    }
    accepted_.add(waitingAddr_);
    acceptedChanged_ = true;
    trusted_ = waiting_;
    waiting_ = 0;
    onConnect();
    if (waitingEncrypted_) {
        onEncrypted(true);
    }
    waitingEncrypted_ = false;
    window_.close();
    return true;
}

bool BleMidiLink::expireWaiting(uint32_t nowMs) {
    if (waiting_ != 0 && !window_.allowed(nowMs)) {
        queueDelete(waitingAddr_);
        waiting_ = 0;
        waitingEncrypted_ = false;
        return true;
    }
    return false;
}

void BleMidiLink::onConnect() {
    connected_ = true;
    encrypted_ = false;
    subscribed_ = false;
    guides_.clear();
    parser_.reset();
    outCount_ = 0;
}

void BleMidiLink::onDisconnect() {
    connected_ = false;
    encrypted_ = false;
    subscribed_ = false;
    guides_.clear();
    parser_.reset();
    outCount_ = 0;
    port_.startAdvertising();  // so the next central can find the hub without a reset
}

void BleMidiLink::onReceive(const uint8_t *data, size_t length, uint32_t nowMs) {
    if (!connected_ || !encrypted_) {
        return;  // writes from a link that is not bonded and encrypted are ignored
    }
    parser_.feedPacket(data, length, nowMs, *this);
}

void BleMidiLink::queueOut(const NoteEvent &event) {
    if (!connected_ || !subscribed_ || !encrypted_) {
        return;
    }
    if (outCount_ == kOutQueue) {
        memmove(&out_[0], &out_[1], sizeof(NoteEvent) * (kOutQueue - 1));
        outCount_--;
        outDropped_++;
    }
    out_[outCount_++] = event;
}

void BleMidiLink::pump() {
    if (!connected_ || !subscribed_ || outCount_ == 0) {
        return;
    }
    // one header, then a timestamp and three bytes per note. The header and
    // timestamps carry the low 13 bits of the clock
    uint8_t packet[1 + 4 * kMaxPacketNotes];
    size_t used = 0;
    size_t taken = 0;
    for (; taken < outCount_ && taken < kMaxPacketNotes; taken++) {
        uint8_t one[5];
        if (encodeBleNote(out_[taken], one) == 0) {
            continue;
        }
        if (used == 0) {
            packet[used++] = one[0];
        }
        memcpy(packet + used, one + 1, 4);
        used += 4;
    }
    if (used == 0) {
        outCount_ = 0;
        return;
    }
    if (port_.notify(packet, used)) {
        memmove(&out_[0], &out_[taken], sizeof(NoteEvent) * (outCount_ - taken));
        outCount_ -= taken;
    }  // else keep them: the stack is busy and the next pump retries
}

}  // namespace melophos
