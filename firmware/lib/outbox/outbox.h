#pragma once

#include "hal.h"
#include "publish.h"

namespace melophos {

// keeps the last session across a power cut. At the end of every session the
// events not yet acknowledged and the session's details are written to flash
// and when the whole session has been delivered a flag is cleared in place with
// no erase. After a restart a session that was not delivered is queued again.
//
//   4 sectors: two slots of 2 sectors that take turns (profile store style)
//   record     up to 1000 events (the newest) in 8 bytes each: under 8 kB
//   writes     a save that happens is one 2 sector erase and delivery adds none. At most one save is made
//              every 10 minutes (see rate above): a session that ends sooner is not saved.
//              With 5 sessions a day that is 10 sector erases a day, 2.5 on each
//              of the 4 sectors, which a 100 000 cycle part lasts over 100 years of
//   not saved  a session whose start could not be dated (the clock was never set)
//
// A power cut in the middle of delivery can send the last notes of a session
// twice after the restart, because the server only drops a repeat of the same
// (boot, seq) and a restart starts a new boot.
class Outbox : public SessionPublisher::EndListener {
   public:
    static const size_t kMaxEvents = 1000;
    static const uint32_t kSectors = 4;
    struct Saved {
        char ref[kRefMax + 1];
        char profile[33];
        char mode[8];
        int64_t startWall;
        uint16_t count;
        uint16_t lost;  // events over the 1000 limit that were not kept
        StoredEvent events[kMaxEvents];
    };

    // with a clock, saves are at most one every 10 minutes: a session that ends sooner is not saved
    // (it is still queued in RAM). That bounds the wear, see the arithmetic above
    Outbox(Flash &flash, uint32_t firstSector, Clock *clock = nullptr, uint32_t minIntervalMs = 600000)
        : flash_(flash), first_(firstSector), clock_(clock), minIntervalMs_(minIntervalMs) {}
    void sessionEnded(const QueueEntry &session, const StoredEvent *unsent, size_t count) override;
    // the newest record that was not marked delivered
    bool load(Saved &out);
    // call when the queue no longer holds the saved session. Clears the flag in place
    bool markDelivered();
    uint32_t writes() const { return writes_; }
    // sessions that ended too soon after the last save to be written again
    uint32_t skipped() const { return skipped_; }

   private:
    Flash &flash_;
    uint32_t first_;
    Clock *clock_;
    uint32_t minIntervalMs_;
    uint32_t lastSaveMs_ = 0;
    bool saved_ = false;
    uint32_t skipped_ = 0;
    uint32_t writes_ = 0;
    uint32_t newestSeq_ = 0;
    bool seqKnown_ = false;
    int newestSlot_ = -1;
    bool readSlot(int slot, Saved *out, uint32_t &seq, bool &delivered);
    bool readBody(const uint8_t *header, uint32_t base, size_t count, uint8_t *body, Saved *out, uint32_t &seq, bool &delivered);
    void scan();
};

}  // namespace melophos
