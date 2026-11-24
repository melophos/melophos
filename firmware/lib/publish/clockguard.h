#pragma once

#include <stdint.h>

#include "hal.h"
#include "publish.h"

namespace melophos {

// wall time from plain SNTP, which has no authentication, so one answer is never believed on its own.
// offer() must be called once per REAL SNTP reply (from the SNTP callback), never with a periodic reading of
// the system clock: the system clock already holds the last reply, so reading it again would make a forged
// answer agree with itself.
//
//   - A reply older than the build time (less a day) is ignored: it is a reset clock.
//   - The first reply is taken at once if it is within 7 days after the build, which cannot make a stored
//     session look old. Any other first reply is held as pending.
//   - After that a reply may move the time FORWARD only within an allowance: kSlackS (10 minutes) plus
//     kCreditPerHourS (10 minutes) for each hour of the hub's own elapsed time (monotonic clock) since the
//     time was last set by agreement. The allowance is spent as it is used, so 60 small steps cannot add up
//     to a large one. A step backward is taken only up to kSlackS.
//   - Any other reply is held as pending. It is believed only when kAgreeReplies separate replies, each at
//     least kReplyGapMs after the one before, agree with each other to within kAgreeToleranceS once the hub's
//     own elapsed time is allowed for. A reply that disagrees starts the count again. Pending is forgotten
//     after kPendingMs.
//   - While a reply is pending the time is the one the hub already had (0 if it never had one), so no stored
//     session is judged against it.
//
// SNTP is only a rough first time, enough to date certificates against. It cannot be made safe: a network that
// answers every SNTP request with the same wrong time for kAgreeReplies replies in a row (about a minute) can
// set the clock anywhere after the build time and no rule about counting replies changes that. So the SERVER
// is the authority on time (it is the server's clock that decides whether a session's date is accepted and the
// hub already talks to it over TLS with certificate checks). offerServer() takes `server_time` from the answer
// to GET /api/v1/device:
//   - with no time yet, the clock is set to it
//   - within kServerToleranceS of the hub's clock the clock is snapped to it (the hub is confirmed right)
//   - further out the hub's clock is CORRECTED to the server's, SNTP is distrusted (its replies are ignored)
//     until one agrees with the corrected clock again and the correction is reported once (takeCorrection)
//   - synced false (the server's clock is not set yet, as after a power cut on a Pi with no clock battery): the
//     hub's clock is NOT corrected from it, every session is held (dated by nothing, nothing sent), the hub asks
//     again at its normal interval and says once on serial that the server's clock is not set. synced absent or
//     null counts as true. When it turns true the held sessions are dated and sent
//   - once the server has been heard, SNTP can no longer move the clock beyond its small allowance: an
//     agreeing run of replies is no longer enough
// An older server that sends no server_time leaves the SNTP rules above as the only protection.
class ClockGuard : public WallClock {
   public:
    static const int64_t kSlackS = 600;
    static const int64_t kCreditPerHourS = 600;
    static const int64_t kFirstWindowS = 7 * 86400;
    static const int kAgreeReplies = 3;
    static const uint32_t kReplyGapMs = 30000;
    static const int64_t kAgreeToleranceS = 5;
    static const uint32_t kPendingMs = 600000;
    static const int64_t kServerToleranceS = 180;  // a few minutes: network delay and the server's own rounding

    ClockGuard(const Clock &mono, int64_t buildEpoch, Lock *lock = nullptr) : mono_(mono), build_(buildEpoch), lock_(lock ? lock : &none_) {}
    // one real SNTP reply, as epoch seconds
    void offer(int64_t candidate);
    int64_t epochSeconds() const override;
    bool pending() const { return pending_; }
    // true once a time has been believed
    bool trusted() const { return have_; }
    // the server's time. Returns true when it corrected the clock (see above)
    bool offerServer(int64_t serverTime, bool synced = true);
    int64_t datingSeconds() const override;
    bool holding() const override { return serverUnsynced_; }
    // true once after a correction: delta is how far the clock moved (server minus hub) and sinceMs is the uptime
    // from which dates may have been taken from the wrong clock (sessions queued from then need re-dating)
    bool takeCorrection(int64_t &delta, uint32_t &sinceMs) {
        if (!corrected_) {
            return false;
        }
        corrected_ = false;
        delta = correction_;
        sinceMs = suspectSinceMs_;
        return true;
    }
    bool sntpDistrusted() const { return distrusted_; }
    bool serverHeard() const { return serverSeen_; }

   private:
    const Clock &mono_;
    int64_t build_;
    Lock none_;
    Lock *lock_;
    bool have_ = false;
    int64_t base_ = 0;  // believed epoch at anchorMs_
    uint32_t anchorMs_ = 0;
    uint32_t creditSinceMs_ = 0;  // when the time was last set by agreement or first taken
    int64_t used_ = 0;            // forward allowance spent since then
    bool pending_ = false;
    int64_t pendingValue_ = 0;  // the last reply that counted towards agreement
    uint32_t pendingMs_ = 0;
    int agree_ = 0;
    bool serverSeen_ = false;
    bool serverUnsynced_ = false;
    bool distrusted_ = false;
    bool corrected_ = false;
    int64_t correction_ = 0;
    uint32_t suspectSinceMs_ = 0;  // uptime of the first time set since the server last confirmed the clock
    bool suspectSet_ = false;
    int64_t nowLocked() const;
};

// joins the server's time to the clock, the queue and the recording session: a correction re-dates what was
// dated from the wrong clock. `say` reports a correction once on serial (may be null)
class ClockSync : public ServerTimeSink {
   public:
    // publisher may be null when the session is on another thread: the correction is then kept for
    // takeSessionRedate, which that thread calls (the lock guards the hand-over)
    ClockSync(ClockGuard &guard, OfflineQueue &queue, SessionPublisher *publisher, void (*say)(const char *), Lock *lock = nullptr)
        : guard_(guard), queue_(queue), publisher_(publisher), say_(say), lock_(lock ? lock : &none_) {}
    void onServerTime(int64_t utcSeconds, bool synced) override;
    bool takeSessionRedate(int64_t &delta, uint32_t &sinceMs);

   private:
    ClockGuard &guard_;
    OfflineQueue &queue_;
    SessionPublisher *publisher_;
    void (*say_)(const char *);
    Lock none_;
    Lock *lock_;
    bool unsyncedSaid_ = false;
    bool redatePending_ = false;
    int64_t redateDelta_ = 0;
    uint32_t redateSince_ = 0;
};

// the build time as epoch seconds from the compiler's __DATE__ ("Nov 22 2026") and __TIME__ ("12:34:56"), 0 if
// they do not parse
int64_t buildEpochFrom(const char *date, const char *time);

}  // namespace melophos
