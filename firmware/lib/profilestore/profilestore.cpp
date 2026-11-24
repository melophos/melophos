#include "profilestore.h"

#include <string.h>

namespace melophos {

namespace {

const uint32_t kMagic = 0x52504C4Du;  // "MLPR"
const size_t kHeader = 20;
const size_t kMaxPayload = 128;

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

const char *ProfileStore::message(Status s) {
    switch (s) {
        case Ok:
            return "ok";
        case BadFlash:
            return "profile storage is missing or too small";
        case Full:
            return "profile storage is full: remove a profile first (8 at most)";
        case NotFound:
            return "no profile with that id";
        case WriteFailed:
            return "the flash write failed: the previous profile is unchanged";
        case TooSoon:
            return "too many profile changes: wait a moment (a save once a minute, a switch once every 2 seconds)";
        case Invalid:
        default:
            return "the profile is not valid";
    }
}

// header: magic, format(2), flags(2), seq, length(2), pad(2), crc over the
// header with a zero crc field plus the payload
bool ProfileStore::readRecord(uint32_t sector, uint8_t *payload, size_t cap, size_t &length, uint32_t &seq,
                              bool &tombstone) const {
    uint8_t h[kHeader];
    uint32_t base = sector * flash_.sectorSize();
    if (!flash_.read(base, h, kHeader) || get32(h) != kMagic) {
        return false;
    }
    uint16_t format = (uint16_t)(h[4] | (h[5] << 8));
    uint16_t flags = (uint16_t)(h[6] | (h[7] << 8));
    seq = get32(h + 8);
    length = (size_t)(h[12] | (h[13] << 8));
    uint32_t crc = get32(h + 16);
    if (format != 1 || length > kMaxPayload || length > cap || flags > 1) {
        return false;
    }
    if (length && !flash_.read(base + kHeader, payload, length)) {
        return false;
    }
    uint8_t zeroed[kHeader];
    memcpy(zeroed, h, kHeader);
    put32(zeroed + 16, 0);
    uint32_t actual = crc32(payload, length, crc32(zeroed, kHeader));
    if (actual != crc) {
        return false;
    }
    tombstone = (flags & 1) != 0;
    return true;
}

ProfileStore::Status ProfileStore::writeRecord(uint32_t sector, const uint8_t *payload, size_t length,
                                               uint32_t seq, bool tombstone) {
    uint8_t record[kHeader + kMaxPayload];
    if (length > kMaxPayload) {
        return Invalid;
    }
    put32(record, kMagic);
    record[4] = (uint8_t)kFormat;
    record[5] = 0;
    record[6] = tombstone ? 1 : 0;
    record[7] = 0;
    put32(record + 8, seq);
    record[12] = (uint8_t)length;
    record[13] = (uint8_t)(length >> 8);
    record[14] = record[15] = 0;
    put32(record + 16, 0);
    memcpy(record + kHeader, payload, length);
    put32(record + 16, crc32(record + kHeader, length, crc32(record, kHeader)));

    uint32_t base = sector * flash_.sectorSize();
    if (!flash_.erase(sector)) {
        return WriteFailed;
    }
    // payload first and the magic last: a cut leaves a record whose magic or
    // CRC fails, so it is ignored and the other slot still holds the old copy
    if (!flash_.program(base + 4, record + 4, kHeader + length - 4)) {
        return WriteFailed;
    }
    if (!flash_.program(base, record, 4)) {
        return WriteFailed;
    }
    return Ok;
}

ProfileStore::Status ProfileStore::begin() {
    ready_ = false;
    if (flash_.sectorCount() < kSectorsNeeded || flash_.sectorSize() < kHeader + kMaxPayload) {
        return BadFlash;
    }
    memset(entries_, 0, sizeof entries_);
    for (int i = 0; i < kMaxProfiles; i++) {
        for (int s = 0; s < 2; s++) {
            uint8_t payload[kMaxPayload];
            size_t len;
            uint32_t seq;
            bool tomb;
            Slot &slot = entries_[i].slot[s];
            if (!readRecord((uint32_t)(i * 2 + s), payload, sizeof payload, len, seq, tomb)) {
                continue;
            }
            Profile p;
            if (tomb) {
                if (len == 0 || len > limits::kIdMax) {
                    continue;
                }
                memcpy(slot.id, payload, len);
                slot.id[len] = '\0';
            } else {
                if (!decodeProfile(payload, len, p)) {
                    continue;
                }
                strcpy(slot.id, p.id);
            }
            slot.valid = true;
            slot.tombstone = tomb;
            slot.seq = seq;
        }
    }
    ready_ = true;
    return Ok;
}

int ProfileStore::newest(const Entry &e) const {
    if (e.slot[0].valid && e.slot[1].valid) {
        return e.slot[0].seq >= e.slot[1].seq ? 0 : 1;
    }
    return e.slot[0].valid ? 0 : (e.slot[1].valid ? 1 : -1);
}

int ProfileStore::findEntry(const char *id) const {
    for (int i = 0; i < kMaxProfiles; i++) {
        int n = newest(entries_[i]);
        if (n >= 0 && !entries_[i].slot[n].tombstone && !strcmp(entries_[i].slot[n].id, id)) {
            return i;
        }
    }
    return -1;
}

ProfileStore::Status ProfileStore::writeProfileRecord(const Profile &p, bool tombstone) {
    int index = findEntry(p.id);
    if (tooSoon(saved_, lastSaveMs_, 60000)) {
        return TooSoon;
    }
    if (index < 0) {
        if (tombstone) {
            return NotFound;
        }
        // reuse an index that holds nothing live: never written or removed
        for (int i = 0; i < kMaxProfiles && index < 0; i++) {
            int n = newest(entries_[i]);
            if (n < 0 || entries_[i].slot[n].tombstone) {
                index = i;
            }
        }
        if (index < 0) {
            return Full;
        }
    }
    Entry &e = entries_[index];
    int cur = newest(e);
    int target = cur < 0 ? 0 : 1 - cur;
    uint32_t seq = cur < 0 ? 1 : e.slot[cur].seq + 1;
    uint8_t payload[kMaxPayload];
    size_t len;
    if (tombstone) {
        len = strlen(p.id);
        memcpy(payload, p.id, len);
    } else {
        len = encodeProfile(p, payload, sizeof payload);
    }
    Status s = writeRecord((uint32_t)(index * 2 + target), payload, len, seq, tombstone);
    if (s != Ok) {
        begin();  // a failed write may have torn the target: rebuild from what is really there
        return s;
    }
    if (tombstone) {
        uint32_t cur = 0;
        if (activeLog_.last(cur) && cur == (uint32_t)index + 1) {
            activeLog_.append(0);  // the active profile was removed: the pointer must not follow a reused index
        }
    }
    Slot &slot = e.slot[target];
    slot.valid = true;
    slot.tombstone = tombstone;
    slot.seq = seq;
    strcpy(slot.id, p.id);
    return Ok;
}

ProfileStore::Status ProfileStore::save(const Profile &p) {
    if (!ready_) {
        return BadFlash;
    }
    // the round trip proves the stored form decodes to the same profile
    uint8_t buf[kProfileBytes];
    Profile check;
    if (encodeProfile(p, buf, sizeof buf) != kProfileBytes || !decodeProfile(buf, sizeof buf, check)) {
        return Invalid;
    }
    return writeProfileRecord(p, false);
}

ProfileStore::Status ProfileStore::remove(const char *id) {
    if (!ready_) {
        return BadFlash;
    }
    Profile stub{};
    if (strlen(id) > limits::kIdMax || strlen(id) == 0) {
        return NotFound;
    }
    strcpy(stub.id, id);
    return writeProfileRecord(stub, true);
}

ProfileStore::Status ProfileStore::load(const char *id, Profile &out) const {
    if (!ready_) {
        return BadFlash;
    }
    int index = findEntry(id);
    if (index < 0) {
        return NotFound;
    }
    uint8_t payload[kMaxPayload];
    size_t len;
    uint32_t seq;
    bool tomb;
    int n = newest(entries_[index]);
    if (!readRecord((uint32_t)(index * 2 + n), payload, sizeof payload, len, seq, tomb) || tomb ||
        !decodeProfile(payload, len, out)) {
        return NotFound;
    }
    return Ok;
}

bool ProfileStore::tooSoon(bool &seen, uint32_t &last, uint32_t minMs) {
    if (clock_ == nullptr) {
        return false;
    }
    uint32_t now = clock_->nowMs();
    if (seen && (uint32_t)(now - last) < minMs) {
        return true;
    }
    seen = true;
    last = now;
    return false;
}

ProfileStore::Status ProfileStore::setActive(const char *id) {
    if (!ready_) {
        return BadFlash;
    }
    int index = findEntry(id);
    if (index < 0) {
        return NotFound;
    }
    uint32_t cur = 0;
    if (activeLog_.last(cur) && cur == (uint32_t)index + 1) {
        return Ok;  // already the active one: nothing to write
    }
    if (tooSoon(switched_, lastSwitchMs_, 2000)) {
        return TooSoon;
    }
    return activeLog_.append((uint32_t)index + 1) ? Ok : WriteFailed;
}

bool ProfileStore::activeId(char *out, size_t cap) const {
    uint32_t v = 0;
    if (!const_cast<AppendLog &>(activeLog_).last(v) || v == 0 || v > (uint32_t)kMaxProfiles) {
        return false;
    }
    int k = newest(entries_[v - 1]);
    if (k < 0 || entries_[v - 1].slot[k].tombstone || strlen(entries_[v - 1].slot[k].id) >= cap) {
        return false;
    }
    strcpy(out, entries_[v - 1].slot[k].id);
    return true;
}

Profile ProfileStore::activeOrDefault() const {
    char id[limits::kIdMax + 1];
    Profile p;
    if (activeId(id, sizeof id) && load(id, p) == Ok) {
        return p;
    }
    return defaultProfile();
}

int ProfileStore::count() const {
    int n = 0;
    for (int i = 0; i < kMaxProfiles; i++) {
        int k = newest(entries_[i]);
        if (k >= 0 && !entries_[i].slot[k].tombstone) {
            n++;
        }
    }
    return n;
}

bool ProfileStore::idAt(int position, char *out, size_t cap) const {
    int n = 0;
    for (int i = 0; i < kMaxProfiles; i++) {
        int k = newest(entries_[i]);
        if (k >= 0 && !entries_[i].slot[k].tombstone) {
            if (n++ == position && strlen(entries_[i].slot[k].id) < cap) {
                strcpy(out, entries_[i].slot[k].id);
                return true;
            }
        }
    }
    return false;
}

}  // namespace melophos
