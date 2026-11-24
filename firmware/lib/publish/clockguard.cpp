#include "clockguard.h"

#include <string.h>

namespace melophos {

int64_t ClockGuard::nowLocked() const {
    if (!have_) {
        return 0;
    }
    return base_ + (int64_t)((uint32_t)(mono_.nowMs() - anchorMs_) / 1000u);
}

int64_t ClockGuard::epochSeconds() const {
    LockGuard g(*lock_);
    return nowLocked();
}

void ClockGuard::offer(int64_t c) {
    LockGuard g(*lock_);
    uint32_t nowMs = mono_.nowMs();
    if (c <= 0 || c < build_ - 86400) {
        return;  // not a time at all or older than this firmware: a clock that was reset
    }
    if (distrusted_) {
        // after a correction by the server SNTP counts again only once it agrees with the corrected clock
        if (have_ && c - nowLocked() <= kServerToleranceS && nowLocked() - c <= kServerToleranceS) {
            distrusted_ = false;
        } else {
            return;
        }
    }
    auto accept = [&](int64_t value, bool resetCredit) {
        if (!suspectSet_) {
            suspectSet_ = true;
            suspectSinceMs_ = nowMs;  // from here on dates came from a clock the server has not confirmed
        }
        have_ = true;
        base_ = value;
        anchorMs_ = nowMs;
        pending_ = false;
        agree_ = 0;
        if (resetCredit) {
            creditSinceMs_ = nowMs;
            used_ = 0;
        }
    };
    if (!have_) {
        if (c <= build_ + kFirstWindowS) {
            accept(c, true);
            return;
        }
    } else {
        int64_t jump = c - nowLocked();
        if (jump < 0 && jump >= -kSlackS) {
            accept(c, false);  // a small step back
            return;
        }
        if (jump >= 0) {
            int64_t hours = (int64_t)((uint32_t)(nowMs - creditSinceMs_) / 3600000u);
            int64_t partS = (int64_t)((uint32_t)(nowMs - creditSinceMs_) % 3600000u) / 1000;
            int64_t allowed = kSlackS + hours * kCreditPerHourS + partS * kCreditPerHourS / 3600 - used_;
            if (jump <= allowed) {
                accept(c, false);
                used_ += jump;
                return;
            }
        }
    }
    if (serverSeen_) {
        return;  // the server is the authority: a run of agreeing SNTP replies no longer moves the clock far
    }
    // anything else is held until separate replies agree
    if (pending_ && (uint32_t)(nowMs - pendingMs_) > kPendingMs) {
        pending_ = false;
        agree_ = 0;
    }
    if (!pending_) {
        pending_ = true;
        pendingValue_ = c;
        pendingMs_ = nowMs;
        agree_ = 1;
        return;
    }
    uint32_t gap = (uint32_t)(nowMs - pendingMs_);
    if (gap < kReplyGapMs) {
        return;  // too soon after the last one to be a separate opinion
    }
    int64_t expected = pendingValue_ + (int64_t)(gap / 1000u);
    int64_t diff = c > expected ? c - expected : expected - c;
    if (diff > kAgreeToleranceS) {
        pendingValue_ = c;  // it disagrees: the count starts again from this reply
        pendingMs_ = nowMs;
        agree_ = 1;
        return;
    }
    pendingValue_ = c;
    pendingMs_ = nowMs;
    agree_++;
    if (agree_ >= kAgreeReplies) {
        accept(c, true);
    }
}

int64_t ClockGuard::datingSeconds() const {
    LockGuard g(*lock_);
    return serverUnsynced_ ? 0 : nowLocked();
}

bool ClockGuard::offerServer(int64_t t, bool synced) {
    LockGuard g(*lock_);
    if (t <= 0) {
        return false;
    }
    serverUnsynced_ = !synced;
    if (!synced) {
        return false;  // the server does not trust its own clock: nothing is corrected from it
    }
    uint32_t nowMs = mono_.nowMs();
    int64_t cur = nowLocked();
    bool hadTime = have_;
    int64_t diff = t - cur;
    serverSeen_ = true;
    have_ = true;
    base_ = t;
    anchorMs_ = nowMs;
    creditSinceMs_ = nowMs;
    used_ = 0;
    pending_ = false;
    agree_ = 0;
    if (hadTime && (diff > kServerToleranceS || diff < -kServerToleranceS)) {
        corrected_ = true;
        correction_ = diff;
        distrusted_ = true;
        // dates taken from the wrong clock reach back to the first time it was set since the server last agreed
        if (!suspectSet_) {
            suspectSinceMs_ = nowMs;  // no SNTP time was taken since the server last agreed: nothing earlier is suspect
        }
        suspectSet_ = false;  // the corrected clock starts a new epoch
        return true;
    }
    suspectSet_ = false;  // confirmed: nothing before now is suspect
    return false;
}

void ClockSync::onServerTime(int64_t utc, bool synced) {
    bool corrected = guard_.offerServer(utc, synced);
    if (!synced) {
        if (!unsyncedSaid_ && say_ != nullptr) {
            unsyncedSaid_ = true;
            say_("time: the server's clock is not set yet, so the hub holds its sessions and asks again. Nothing is lost");
        }
        return;
    }
    unsyncedSaid_ = false;
    int64_t delta = 0;
    uint32_t since = 0;
    if (guard_.takeCorrection(delta, since)) {
        queue_.redate(delta, since);
        if (publisher_ != nullptr) {
            publisher_->redate(delta, since);
        } else {
            LockGuard g(*lock_);
            redateDelta_ = redatePending_ ? redateDelta_ + delta : delta;
            redateSince_ = redatePending_ && (int32_t)(redateSince_ - since) < 0 ? redateSince_ : since;
            redatePending_ = true;
        }
        if (corrected && say_ != nullptr) {
            say_("time: the hub's clock was wrong by more than a few minutes and was corrected to the server's. SNTP is not trusted until it agrees again");
        }
    }
}

bool ClockSync::takeSessionRedate(int64_t &delta, uint32_t &sinceMs) {
    LockGuard g(*lock_);
    if (!redatePending_) {
        return false;
    }
    redatePending_ = false;
    delta = redateDelta_;
    sinceMs = redateSince_;
    return true;
}

int64_t buildEpochFrom(const char *date, const char *time) {
    static const char *months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    if (date == nullptr || time == nullptr || strlen(date) != 11 || strlen(time) != 8) {
        return 0;
    }
    int m = -1;
    for (int i = 0; i < 12; i++) {
        if (strncmp(date, months + i * 3, 3) == 0) {
            m = i + 1;
        }
    }
    int d = (date[4] == ' ' ? 0 : date[4] - '0') * 10 + (date[5] - '0');
    int y = (date[7] - '0') * 1000 + (date[8] - '0') * 100 + (date[9] - '0') * 10 + (date[10] - '0');
    int hh = (time[0] - '0') * 10 + (time[1] - '0');
    int mm = (time[3] - '0') * 10 + (time[4] - '0');
    int ss = (time[6] - '0') * 10 + (time[7] - '0');
    if (m < 0 || d < 1 || d > 31 || y < 2020 || y > 2100) {
        return 0;
    }
    // days from civil
    int64_t yy = y - (m <= 2 ? 1 : 0);
    int64_t era = yy / 400;
    int64_t yoe = yy - era * 400;
    int64_t mp = m > 2 ? m - 3 : m + 9;
    int64_t doy = (153 * mp + 2) / 5 + d - 1;
    int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return (era * 146097 + doe - 719468) * 86400 + hh * 3600 + mm * 60 + ss;
}

}  // namespace melophos
