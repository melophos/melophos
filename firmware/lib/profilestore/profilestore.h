#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "profile.h"
#include "recordpair.h"

namespace melophos {

// profiles in flash. Each of up to 8 profiles owns two sectors and each save
// goes to the sector that does NOT hold the current copy, so a power cut at
// any point leaves the old copy intact. A record is only believed when its
// magic, format version and CRC-32 all check out.
//
//   sectors 0..15  profile slots (profile i uses 2i and 2i+1)
//   sectors 16,17  the active-profile pointer: an append-only log (see AppendLog), 511 switches per erase
//
// Wear, with the limits that bound a hostile sender (a loop of commands from a phone):
//   switch  one 8 byte append and an erase every 511, over two sectors: one erase per 1022 switches.
//           Limited to one every 2 s, so at worst 43 200 a day, 42 erases a day on a sector, 2400
//           days (6.5 years) to the 100 000 cycles
//   save    one erase of one of the profile's two sectors. Limited to one a minute, so at worst
//           1440 a day, 720 on each sector of that profile, 139 days to 100 000 cycles
//   ordinary day: 3 saves and 10 switches is 3 erases and about 0 for switches
class ProfileStore {
   public:
    static const int kMaxProfiles = 8;
    static const uint32_t kSectorsNeeded = kMaxProfiles * 2 + 2;
    static const uint16_t kFormat = 1;

    enum Status : uint8_t { Ok, BadFlash, Full, NotFound, WriteFailed, Invalid, TooSoon };

    explicit ProfileStore(Flash &flash, Clock *clock = nullptr) : flash_(flash), clock_(clock), activeLog_(flash, kMaxProfiles * 2, kMaxProfiles * 2 + 1, 0x41435456) {}

    // scans flash; a chip that is too small or unreadable reports BadFlash
    Status begin();
    // validates by round trip before touching flash
    Status save(const Profile &p);
    Status remove(const char *id);
    Status load(const char *id, Profile &out) const;
    Status setActive(const char *id);

    int count() const;
    bool idAt(int position, char *out, size_t cap) const;
    // the active profile or the built-in default when none is set or the
    // chosen one has gone missing
    Profile activeOrDefault() const;
    bool activeId(char *out, size_t cap) const;

    static const char *message(Status s);

   private:
    struct Slot {
        bool valid;
        bool tombstone;
        uint32_t seq;
        char id[limits::kIdMax + 1];
    };
    struct Entry {
        Slot slot[2];
    };

    Flash &flash_;
    Entry entries_[kMaxProfiles] = {};
    Clock *clock_;
    AppendLog activeLog_;
    uint32_t lastSaveMs_ = 0, lastSwitchMs_ = 0;
    bool saved_ = false, switched_ = false;
    bool tooSoon(bool &seen, uint32_t &last, uint32_t minMs);
    bool ready_ = false;

    bool readRecord(uint32_t sector, uint8_t *payload, size_t cap, size_t &length, uint32_t &seq,
                    bool &tombstone) const;
    Status writeRecord(uint32_t sector, const uint8_t *payload, size_t length, uint32_t seq, bool tombstone);
    int findEntry(const char *id) const;
    int newest(const Entry &e) const;
    Status writeProfileRecord(const Profile &p, bool tombstone);
};

}  // namespace melophos
