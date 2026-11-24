#include "recordpair.h"

#include <string.h>

namespace melophos {

namespace {
const size_t kHeader = 16;  // magic, seq, length(2), pad(2), crc
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

bool RecordPair::read(int which, uint8_t *out, size_t cap, size_t &len, uint32_t &seq) const {
    uint8_t h[kHeader];
    uint32_t base = sector_[which] * flash_.sectorSize();
    if (!flash_.read(base, h, kHeader) || get32(h) != magic_) {
        return false;
    }
    seq = get32(h + 4);
    len = (size_t)(h[8] | (h[9] << 8));
    if (len > kMaxPayload || len > cap) {
        return false;
    }
    uint8_t payload[kMaxPayload];
    if (len && !flash_.read(base + kHeader, payload, len)) {
        return false;
    }
    uint8_t zeroed[kHeader];
    memcpy(zeroed, h, kHeader);
    put32(zeroed + 12, 0);
    if (crc32(payload, len, crc32(zeroed, kHeader)) != get32(h + 12)) {
        return false;
    }
    memcpy(out, payload, len);
    return true;
}

bool RecordPair::load(uint8_t *out, size_t cap, size_t &len) {
    uint8_t a[kMaxPayload], b[kMaxPayload];
    size_t la = 0, lb = 0;
    uint32_t sa = 0, sb = 0;
    bool okA = read(0, a, sizeof a, la, sa);
    bool okB = read(1, b, sizeof b, lb, sb);
    if (!okA && !okB) {
        return false;
    }
    bool useA = okA && (!okB || sa >= sb);
    const uint8_t *src = useA ? a : b;
    len = useA ? la : lb;
    if (len > cap) {
        return false;
    }
    memcpy(out, src, len);
    return true;
}

bool RecordPair::store(const uint8_t *data, size_t len) {
    if (len > kMaxPayload) {
        return false;
    }
    uint8_t scratch[kMaxPayload];
    size_t l;
    uint32_t sa = 0, sb = 0;
    bool okA = read(0, scratch, sizeof scratch, l, sa);
    bool okB = read(1, scratch, sizeof scratch, l, sb);
    int cur = okA && (!okB || sa >= sb) ? 0 : (okB ? 1 : -1);
    int target = cur < 0 ? 0 : 1 - cur;
    uint32_t seq = cur < 0 ? 1 : (cur == 0 ? sa : sb) + 1;
    uint8_t record[kHeader + kMaxPayload];
    put32(record, magic_);
    put32(record + 4, seq);
    record[8] = (uint8_t)len;
    record[9] = 0;
    record[10] = record[11] = 0;
    put32(record + 12, 0);
    memcpy(record + kHeader, data, len);
    put32(record + 12, crc32(record + kHeader, len, crc32(record, kHeader)));
    uint32_t base = sector_[target] * flash_.sectorSize();
    // the magic goes last, so a torn write leaves a sector that is simply ignored
    return flash_.erase(sector_[target]) && flash_.program(base + 4, record + 4, kHeader + len - 4) &&
           flash_.program(base, record, 4);
}

// ---------- append-only log ----------

namespace {
const uint32_t kHeaderTag = 0x48454144;  // "HEAD"
}

bool AppendLog::header(int which, uint32_t &epoch) const {
    uint8_t w[8];
    if (!flash_.read(sector_[which] * flash_.sectorSize(), w, 8)) {
        return false;
    }
    uint32_t e = get32(w);
    if (get32(w + 4) != (crc32(w, 4) ^ magic_ ^ kHeaderTag)) {
        return false;
    }
    epoch = e;
    return true;
}

bool AppendLog::readSlot(int which, size_t slot, uint32_t &value, bool &isFree) const {
    uint8_t w[8];
    // flash addresses are 32 bits and slot is below slots(), so the whole sum stays inside one sector of the flash and
    // is worked out in 32 bits from the start instead of being widened halfway through
    uint32_t address = sector_[which] * flash_.sectorSize() + (uint32_t)slot * 8;
    if (!flash_.read(address, w, 8)) {
        isFree = false;
        return false;
    }
    isFree = true;
    for (uint8_t b : w) {
        isFree = isFree && b == 0xFF;
    }
    if (isFree) {
        return false;
    }
    value = get32(w);
    return get32(w + 4) == (crc32(w, 4) ^ magic_);
}

int AppendLog::newest(uint32_t &epoch, uint32_t &value, size_t &firstFree) const {
    struct Scan {
        bool header = false;
        uint32_t epoch = 0;
        bool have = false;
        uint32_t last = 0;
        uint32_t bad = 0;  // records after the last good one that are not blank and do not check out
        size_t free = 0;
    } sc[2];
    for (int which = 0; which < 2; which++) {
        Scan &c = sc[which];
        c.header = header(which, c.epoch);
        c.free = slots();
        if (!c.header) {
            continue;
        }
        for (size_t slot = 1; slot < slots(); slot++) {
            uint32_t v;
            bool isFree;
            bool ok = readSlot(which, slot, v, isFree);
            if (isFree) {
                c.free = slot;
                break;
            }
            if (ok) {
                c.have = true;
                c.last = v;
                c.bad = 0;
            } else {
                c.bad++;
            }
        }
    }
    int best = -1;
    for (int which = 0; which < 2; which++) {
        const Scan &c = sc[which];
        if (!c.header || (!c.have && !(counter_ && c.bad > 0))) {
            continue;  // a header with no record yet: the other sector still holds the value
        }
        if (best < 0 || (int32_t)(c.epoch - epoch) > 0) {
            best = which;
            epoch = c.epoch;
            firstFree = c.free;
            if (c.have) {
                value = c.last + (counter_ ? c.bad : 0);
            } else {
                // only unreadable records here: they count as used numbers on top of the older sector's value
                const Scan &o = sc[1 - which];
                uint32_t base = o.header && o.have ? o.last + o.bad : 0;
                value = base + c.bad;
            }
        }
    }
    return best;
}

bool AppendLog::damaged() const {
    for (int which = 0; which < 2; which++) {
        uint32_t e;
        if (header(which, e)) {
            continue;
        }
        for (size_t slot = 1; slot < slots(); slot++) {
            uint32_t v;
            bool isFree;
            bool ok = readSlot(which, slot, v, isFree);
            if (isFree) {
                break;
            }
            if (ok) {
                return true;  // records behind a bad header
            }
        }
    }
    return false;
}

bool AppendLog::last(uint32_t &value) {
    if (damaged()) {
        return false;
    }
    uint32_t epoch = 0;
    size_t free = 0;
    return newest(epoch, value, free) >= 0;
}

bool AppendLog::append(uint32_t value) {
    if (damaged()) {
        return false;
    }
    uint32_t epoch = 0, last = 0;
    size_t free = 0;
    int cur = newest(epoch, last, free);
    uint8_t rec[8];
    put32(rec, value);
    put32(rec + 4, crc32(rec, 4) ^ magic_);
    if (cur >= 0 && free < slots()) {
        // room in the current sector: append, no erase
        uint32_t base = sector_[cur] * flash_.sectorSize() + (uint32_t)free * 8;
        return flash_.program(base, rec, 4) && flash_.program(base + 4, rec + 4, 4);
    }
    // the current sector is full or there is none yet: erase the OTHER one and start it
    int target = cur < 0 ? 0 : 1 - cur;
    uint32_t newEpoch = cur < 0 ? 1 : epoch + 1;
    uint8_t head[8];
    put32(head, newEpoch);
    put32(head + 4, crc32(head, 4) ^ magic_ ^ kHeaderTag);
    uint32_t base = sector_[target] * flash_.sectorSize();
    return flash_.erase(sector_[target]) && flash_.program(base, head, 4) && flash_.program(base + 4, head + 4, 4) &&
           flash_.program(base + 8, rec, 4) && flash_.program(base + 12, rec + 4, 4);
}

uint32_t DurableCounter::value() {
    uint32_t v = 0;
    return log_.last(v) ? v : 0;
}

bool DurableCounter::raiseTo(uint32_t v) {
    if (v <= value()) {
        return true;
    }
    return log_.append(v);
}

uint32_t DurableCounter::next() {
    uint32_t n = value() + 1;
    if (n == 0) {
        return 0;
    }
    return raiseTo(n) ? n : 0;
}

BootStart peekBoot(DurableCounter &counter) {
    if (counter.damaged()) {
        return BootStart{BootStart::Lost, 0};  // never reuse a number on the strength of an older record
    }
    uint32_t before = counter.value();
    // a counter of 0 is Fresh even for a paired hub: the first boot is committed only when the broker accepts
    // the hub, so a hub paired but never connected legitimately has none. A counter that was really wiped is
    // caught by the server's range check (boot must be above last_boot), which stops publication with a reason
    if (before == 0xFFFFFFFFu) {
        return BootStart{BootStart::Lost, 0};
    }
    return BootStart{before == 0 ? BootStart::Fresh : BootStart::Continued, before + 1};
}

bool commitBoot(DurableCounter &counter, uint32_t boot) {
    if (boot == 0) {
        return false;
    }
    if (counter.raiseTo(boot) || counter.raiseTo(boot)) {  // a torn write leaves the old value, so one retry is safe
        return counter.value() == boot;
    }
    return false;
}

bool bootInRange(uint32_t boot, int64_t last) {
    if (last < 0) {
        return true;  // the server did not say: nothing to compare with
    }
    if (last == 0) {
        return boot >= 1 && boot <= 1000000;  // a new device may start anywhere up to 1 000 000
    }
    return (int64_t)boot > last && (int64_t)boot <= last + 1000;
}

}  // namespace melophos
