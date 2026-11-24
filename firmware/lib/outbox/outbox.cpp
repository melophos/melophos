#include "outbox.h"

#include <string.h>

#include <new>

namespace melophos {

namespace {
const uint32_t kMagic = 0x584F544Du;  // "MTOX"
// header: magic 4, seq 4, count 2, lost 2, startWall 8, ref 25, profile 33, mode 8, pad 3, crc 4, delivered 4
const size_t kHeader = 4 + 4 + 2 + 2 + 8 + 25 + 33 + 8 + 3 + 4 + 4;
const size_t kDeliveredAt = kHeader - 4;
const size_t kCrcAt = kHeader - 8;
void put32(uint8_t *d, uint32_t v) {
    d[0] = (uint8_t)v;
    d[1] = (uint8_t)(v >> 8);
    d[2] = (uint8_t)(v >> 16);
    d[3] = (uint8_t)(v >> 24);
}
uint32_t get32(const uint8_t *d) {
    return d[0] | ((uint32_t)d[1] << 8) | ((uint32_t)d[2] << 16) | ((uint32_t)d[3] << 24);
}
}  // namespace

bool Outbox::readSlot(int slot, Saved *out, uint32_t &seq, bool &delivered) {
    uint32_t base = (first_ + (uint32_t)slot * 2) * flash_.sectorSize();
    uint8_t h[kHeader];
    if (!flash_.read(base, h, kHeader) || get32(h) != kMagic) {
        return false;
    }
    seq = get32(h + 4);
    size_t count = (size_t)(h[8] | (h[9] << 8));
    if (count > kMaxEvents) {
        return false;
    }
    // heap for the length of the call: static buffers of this size do not fit the classic ESP32
    uint8_t *body = new (std::nothrow) uint8_t[kMaxEvents * 8];
    if (body == nullptr) {
        return false;
    }
    bool ok = readBody(h, base, count, body, out, seq, delivered);
    delete[] body;
    return ok;
}

bool Outbox::readBody(const uint8_t *h, uint32_t base, size_t count, uint8_t *body, Saved *out, uint32_t &, bool &delivered) {
    (void)base;
    if (count && !flash_.read(base + kHeader, body, count * 8)) {
        return false;
    }
    uint8_t zeroed[kHeader];
    memcpy(zeroed, h, kHeader);
    put32(zeroed + kCrcAt, 0);
    put32(zeroed + kDeliveredAt, 0);
    if (crc32(body, count * 8, crc32(zeroed, kHeader)) != get32(h + kCrcAt)) {
        return false;
    }
    delivered = get32(h + kDeliveredAt) != 0xFFFFFFFFu;
    if (out) {
        out->count = (uint16_t)count;
        out->lost = (uint16_t)(h[10] | (h[11] << 8));
        out->startWall = 0;
        for (int i = 7; i >= 0; i--) {
            out->startWall = (out->startWall << 8) | h[12 + i];
        }
        memcpy(out->ref, h + 20, 25);
        memcpy(out->profile, h + 45, 33);
        memcpy(out->mode, h + 78, 8);
        out->ref[kRefMax] = '\0';
        out->profile[32] = '\0';
        out->mode[7] = '\0';
        for (size_t i = 0; i < count; i++) {
            out->events[i] = StoredEvent{get32(body + i * 8), body[i * 8 + 4], body[i * 8 + 5], body[i * 8 + 6], body[i * 8 + 7]};
        }
    }
    return true;
}

void Outbox::scan() {
    newestSeq_ = 0;
    newestSlot_ = -1;
    for (int s = 0; s < 2; s++) {
        uint32_t seq;
        bool d;
        if (readSlot(s, nullptr, seq, d) && (newestSlot_ < 0 || seq > newestSeq_)) {
            newestSeq_ = seq;
            newestSlot_ = s;
        }
    }
    seqKnown_ = true;
}

void Outbox::sessionEnded(const QueueEntry &session, const StoredEvent *unsent, size_t count) {
    if (session.startWall == 0) {
        return;  // cannot be dated after a restart, so there is nothing worth keeping
    }
    if (clock_ != nullptr) {
        uint32_t now = clock_->nowMs();
        if (saved_ && (uint32_t)(now - lastSaveMs_) < minIntervalMs_) {
            skipped_++;  // saved a moment ago: the flash is not worn for a session that ends sooner
            return;
        }
        lastSaveMs_ = now;
        saved_ = true;
    }
    if (!seqKnown_) {
        scan();
    }
    size_t keep = count > kMaxEvents ? kMaxEvents : count;
    size_t skip = count - keep;  // the oldest go: the newest are the ones a learner just played
    uint8_t *record = new (std::nothrow) uint8_t[kHeader + kMaxEvents * 8];
    if (record == nullptr) {
        return;
    }
    memset(record, 0, kHeader);
    put32(record, kMagic);
    uint32_t seq = newestSeq_ + 1;
    put32(record + 4, seq);
    record[8] = (uint8_t)keep;
    record[9] = (uint8_t)(keep >> 8);
    record[10] = (uint8_t)skip;
    record[11] = (uint8_t)(skip >> 8);
    for (int i = 0; i < 8; i++) {
        record[12 + i] = (uint8_t)((uint64_t)session.startWall >> (8 * i));
    }
    strncpy((char *)record + 20, session.ref, 24);
    strncpy((char *)record + 45, session.profile, 32);
    strncpy((char *)record + 78, session.mode, 7);
    put32(record + kDeliveredAt, 0xFFFFFFFFu);
    for (size_t i = 0; i < keep; i++) {
        const StoredEvent &e = unsent[skip + i];
        // saved relative to the session start so a new boot's clock does not matter
        put32(record + kHeader + i * 8, e.timeMs - session.startMono);
        record[kHeader + i * 8 + 4] = e.note;
        record[kHeader + i * 8 + 5] = e.velocity;
        record[kHeader + i * 8 + 6] = e.channel;
        record[kHeader + i * 8 + 7] = e.source;
    }
    uint8_t zeroed[kHeader];
    memcpy(zeroed, record, kHeader);
    put32(zeroed + kCrcAt, 0);
    put32(zeroed + kDeliveredAt, 0);
    put32(record + kCrcAt, crc32(record + kHeader, keep * 8, crc32(zeroed, kHeader)));
    int slot = newestSlot_ < 0 ? 0 : 1 - newestSlot_;
    uint32_t sector = first_ + (uint32_t)slot * 2;
    uint32_t base = sector * flash_.sectorSize();
    size_t total = kHeader + keep * 8;
    // the magic goes last, so a cut leaves a slot that is ignored and the other slot still holds the old record
    if (flash_.erase(sector) && flash_.erase(sector + 1) && flash_.program(base + 4, record + 4, total - 4) &&
        flash_.program(base, record, 4)) {
        newestSeq_ = seq;
        newestSlot_ = slot;
        writes_++;
    } else {
        scan();
    }
    delete[] record;
}

bool Outbox::load(Saved &out) {
    scan();
    if (newestSlot_ < 0) {
        return false;
    }
    uint32_t seq;
    bool delivered;
    if (!readSlot(newestSlot_, &out, seq, delivered) || delivered) {
        return false;
    }
    return true;
}

bool Outbox::markDelivered() {
    if (!seqKnown_) {
        scan();
    }
    if (newestSlot_ < 0) {
        return false;
    }
    uint32_t base = (first_ + (uint32_t)newestSlot_ * 2) * flash_.sectorSize();
    uint8_t zero[4] = {0, 0, 0, 0};
    return flash_.program(base + kDeliveredAt, zero, 4);  // bits only go to 0: no erase
}

}  // namespace melophos
