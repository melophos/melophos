#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"

namespace melophos {

// one small value that must survive power cuts, kept in two sectors that take
// turns. A record counts only when its magic, length and CRC-32 agree and
// the newer valid one wins. Used for the boot counter and the update
// version floor.
class RecordPair {
   public:
    static const size_t kMaxPayload = 32;
    RecordPair(Flash &flash, uint32_t sectorA, uint32_t sectorB, uint32_t magic)
        : flash_(flash), sector_{sectorA, sectorB}, magic_(magic) {}

    // false when neither sector holds a valid record. len is set on success
    bool load(uint8_t *out, size_t cap, size_t &len);
    bool store(const uint8_t *data, size_t len);

   private:
    Flash &flash_;
    uint32_t sector_[2];
    uint32_t magic_;
    bool read(int which, uint8_t *out, size_t cap, size_t &len, uint32_t &seq) const;
};

// A list of 32 bit values that grows by appending 8 byte records and erases a sector only when
// that sector is full: 511 records for every erase. Two sectors take turns. A sector starts with a
// header holding its age, so the newer one is known and the value is the last valid record of the
// newest sector that has one. A torn record fails its check and is skipped.
//
// Wear: one erase per 511 appends, spread over two sectors, so a sector is erased once per 1022
// appends. At 100 000 cycles a sector lasts 102 million appends.
class AppendLog {
   public:
    // counter: the log holds a counter that only goes up. A record that is not blank and does not check out
    // (a flipped bit or a write cut short) is then counted as one number used, so the value goes forward past
    // anything that could have been handed out and never back
    AppendLog(Flash &flash, uint32_t sectorA, uint32_t sectorB, uint32_t magic, bool counter = false)
        : flash_(flash), sector_{sectorA, sectorB}, magic_(magic), counter_(counter) {}
    // false when nothing valid has been written
    bool last(uint32_t &value);
    bool append(uint32_t value);
    // a sector with valid records behind a header that does not check out: a bit was lost in the header of
    // the newest sector, so the log would hand back an older value and boots would be handed out again. A
    // header torn by a power cut has no records behind it and is not damage. A damaged log refuses to
    // answer or to write
    bool damaged() const;

   private:
    Flash &flash_;
    uint32_t sector_[2];
    uint32_t magic_;
    bool counter_;
    bool header(int which, uint32_t &epoch) const;
    size_t slots() const { return flash_.sectorSize() / 8; }
    bool readSlot(int which, size_t slot, uint32_t &value, bool &isFree) const;
    // the sector holding the newest data, its epoch and the last value in it. -1 when none
    int newest(uint32_t &epoch, uint32_t &value, size_t &firstFree) const;
};

// A counter that only goes up, over an AppendLog. next() stores the increment before returning it,
// so a number is never handed out twice across power cuts.
class DurableCounter {
   public:
    DurableCounter(Flash &flash, uint32_t sectorA, uint32_t sectorB, uint32_t magic) : log_(flash, sectorA, sectorB, magic, true) {}
    // 0 when nothing was stored. A damaged log also reads 0 and refuses every write (see AppendLog::damaged)
    uint32_t value();
    bool damaged() { return log_.damaged(); }
    // 0 when the flash refuses the write
    uint32_t next();
    // sets the value if it is higher (the update version floor)
    bool raiseTo(uint32_t v);

   private:
    AppendLog log_;
};

// what the boot counter says at power-up. The server accepts a boot at most 1000 above the
// last it saw (a brand new device may start anywhere up to 1 000 000).
//   The counter is raised only when a boot first connects to the broker, never at power-up, so a
//   hub that restarts again and again while offline writes nothing and cannot jump.
//   Fresh      nothing was ever stored: boot 1
//   Continued  the stored value plus one
//   Lost       a log sector's header is damaged with records behind it or the counter is full. Any number it
//              picked could be refused for ever, so it must not publish. It says so and waits for the owner
//              (a counter of 0 is Fresh even when paired: see docs/mqtt.md)
struct BootStart {
    enum Kind : uint8_t { Fresh, Continued, Lost } kind;
    uint32_t boot;  // 0 when Lost
};
// reads the counter and says which boot this would be. Writes nothing
BootStart peekBoot(DurableCounter &counter);
// stores the boot before the first message of this run is sent. False when the flash refuses it
bool commitBoot(DurableCounter &counter, uint32_t boot);

// what the server last saw from this hub (last_boot in GET /api/v1/device, -1 when it did not say)
// against this boot. A new device may start anywhere up to 1 000 000.
bool bootInRange(uint32_t boot, int64_t serverLastBoot);

}  // namespace melophos
