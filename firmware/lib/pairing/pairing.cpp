#include "pairing.h"

#include <stdlib.h>
#include <string.h>

#include "jsonlite.h"

namespace melophos {

namespace {

struct IdentityReply : public JsonSink {
    char id[80] = "";
    char secret[80] = "";
    char code[24] = "";
    double expires = 0;
    bool paired = false;
    bool hasPaired = false;
    char claimedBy[96] = "";
    char undoUntil[40] = "";
    double lastBoot = -1;
    double serverTime = 0;
    bool timeSynced = true;  // an absent or null server_time_synced means the status could not be read: treated as true
    bool leaf(const char *path, JsonKind kind, const char *text, double num, bool flag) override {
        if (!strcmp(path, "device_id") && kind == JsonKind::String) {
            strncpy(id, text, sizeof id - 1);
        } else if (!strcmp(path, "device_secret") && kind == JsonKind::String) {
            strncpy(secret, text, sizeof secret - 1);
        } else if (!strcmp(path, "code") && kind == JsonKind::String) {
            strncpy(code, text, sizeof code - 1);
        } else if (!strcmp(path, "expires_in") && kind == JsonKind::Number) {
            expires = num;
        } else if (!strcmp(path, "claimed_by") && kind == JsonKind::String) {
            strncpy(claimedBy, text, sizeof claimedBy - 1);
        } else if (!strcmp(path, "undo_until") && kind == JsonKind::String) {
            strncpy(undoUntil, text, sizeof undoUntil - 1);
        } else if (!strcmp(path, "last_boot") && kind == JsonKind::Number) {
            lastBoot = num;
        } else if (!strcmp(path, "last_boot") && kind == JsonKind::Null) {
            lastBoot = 0;  // the server has accepted nothing from this hub yet: a new device may start anywhere up to 1 000 000
        } else if (!strcmp(path, "server_time") && kind == JsonKind::Number) {
            serverTime = num;  // absent from an older server: then there is no trusted time to correct by
        } else if (!strcmp(path, "server_time_synced") && kind == JsonKind::Bool) {
            timeSynced = flag;
        } else if (!strcmp(path, "paired") && kind == JsonKind::Bool) {
            paired = flag;
            hasPaired = true;
        }
        return true;  // unknown fields are ignored, as the server's own rule says
    }
};

bool parse(const HttpReply &r, IdentityReply &out) {
    JsonLimits lim{512, 3, 79, 4};
    return jsonWalk(r.body, r.length, lim, out).ok;
}

bool codeOk(const char *c) {
    size_t n = strlen(c);
    if (n < 4 || n > 15) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        bool ok = (c[i] >= 'A' && c[i] <= 'Z') || (c[i] >= '0' && c[i] <= '9') || c[i] == '-';
        if (!ok) {
            return false;
        }
    }
    return true;
}

}  // namespace

void PairingFsm::begin() {
    char id[80], secret[80];
    uint32_t now = clock_.nowMs();
    nextActionMs_ = now;
    code_[0] = '\0';
    refreshed_ = false;
    lastBoot_ = -1;
    // the hour's count survives a restart: the server's limit is 20 identities an hour whatever the hub does
    uint32_t c = 0;
    int64_t start = 0;
    windowLoaded_ = store_.pairWindow(start, c);
    windowStart_ = windowLoaded_ ? start : 0;
    requestsInHour_ = windowLoaded_ ? c : 0;
    if (!store_.device(id, sizeof id, secret, sizeof secret)) {
        state_ = State::NeedsPairing;
    } else if (store_.paired()) {
        state_ = State::Paired;  // refreshed in tick(): one call to learn claimed_by and last_boot
    } else {
        // restarted while waiting for the owner: carry on polling for a fresh window and show the code again
        store_.pairingCode(code_, sizeof code_);
        expiresAtMs_ = now + 600000u;
        state_ = State::Waiting;
    }
}

bool PairingFsm::unclaim() {
    char id[80], secret[80];
    if (!store_.device(id, sizeof id, secret, sizeof secret)) {
        return false;
    }
    HttpReply r{};
    if (!http_.removeClaim(id, secret, r) || r.status < 200 || r.status > 204) {
        return false;
    }
    refreshed_ = false;
    restart(0);  // the server removed the identity and its login: pair again as a new device
    claimedBy_[0] = '\0';
    undoUntil_[0] = '\0';
    return true;
}

void PairingFsm::restart(uint32_t waitMs) {
    store_.clearDevice();
    refreshed_ = false;
    lastBoot_ = -1;
    code_[0] = '\0';
    state_ = State::Backoff;
    nextActionMs_ = clock_.nowMs() + waitMs;
}

void PairingFsm::onUnauthorised() {
    if (state_ == State::Paired || state_ == State::Waiting) {
        restart(0);  // the owner removed this hub or changed its secret: ask for a fresh identity
    }
}

void PairingFsm::request() {
    uint32_t now = clock_.nowMs();
    int64_t wall = wall_.epochSeconds();
    if (wall == 0) {
        // the hour's limit is counted in real time, so without a clock the hub does not ask
        nextActionMs_ = now + 5000;
        state_ = State::Backoff;
        return;
    }
    if (!windowLoaded_ || wall - windowStart_ >= 3600 || wall < windowStart_) {
        windowStart_ = wall;
        requestsInHour_ = 0;
        windowLoaded_ = true;
    }
    if (requestsInHour_ >= kMaxRequestsPerHour) {
        int64_t wait = windowStart_ + 3600 - wall;
        nextActionMs_ = now + (uint32_t)(wait > 0 ? wait : 1) * 1000u;  // the server allows 20 an hour
        state_ = State::Backoff;
        return;
    }
    requestsInHour_++;
    store_.setPairWindow(windowStart_, requestsInHour_);
    HttpReply r{};
    if (!http_.requestIdentity(r) || r.status == 0) {
        nextActionMs_ = now + 30000;
        state_ = State::Backoff;
        return;
    }
    if (r.status == 429) {
        uint32_t wait = r.retryAfterS > 0 && r.retryAfterS < 7200 ? r.retryAfterS : 600;
        nextActionMs_ = now + wait * 1000u;
        state_ = State::Backoff;
        return;
    }
    IdentityReply p;
    const char *why = "";
    if (r.status != 201 || !parse(r, p) || !codeOk(p.code) || p.expires < 30 || p.expires > 3600 ||
        !store_.setDevice(p.id, p.secret, &why)) {
        // anything the hub cannot trust or store is dropped. It tries again later
        nextActionMs_ = now + 60000;
        state_ = State::Backoff;
        return;
    }
    strncpy(code_, p.code, sizeof code_ - 1);
    store_.setPairingCode(p.code);
    claimedBy_[0] = '\0';
    expiresAtMs_ = now + (uint32_t)p.expires * 1000u;
    nextActionMs_ = now + kPollMs;
    state_ = State::Waiting;
}

void PairingFsm::poll() {
    uint32_t now = clock_.nowMs();
    if ((int32_t)(now - expiresAtMs_) >= 0) {
        restart(0);  // not claimed in time: a new request makes a new identity
        return;
    }
    char id[80], secret[80];
    if (!store_.device(id, sizeof id, secret, sizeof secret)) {
        restart(0);
        return;
    }
    HttpReply r{};
    nextActionMs_ = now + kPollMs;
    if (!http_.checkDevice(id, secret, r) || r.status == 0) {
        return;  // a failed poll is just tried again
    }
    if (r.status == 401) {
        restart(0);
        return;
    }
    IdentityReply p;
    if (r.status == 200 && parse(r, p) && timeSink_ != nullptr && p.serverTime > 0) {
        timeSink_->onServerTime((int64_t)p.serverTime, p.timeSynced);
    }
    if (r.status == 200 && p.hasPaired && p.paired) {
        // only now may the hub connect to the broker: the server made its login at this answer
        store_.setPaired(true);
        lastBoot_ = p.lastBoot < 0 ? -1 : (int64_t)p.lastBoot;
        refreshed_ = true;
        strncpy(claimedBy_, p.claimedBy, sizeof claimedBy_ - 1);
        strncpy(undoUntil_, p.undoUntil, sizeof undoUntil_ - 1);
        state_ = State::Paired;
        code_[0] = '\0';
    }
}

void PairingFsm::timeCheck() {
    uint32_t now = clock_.nowMs();
    timeDue_ = false;
    nextTimeMs_ = now + 60000;  // a failed check is tried again in a minute
    char id[80], secret[80];
    if (!store_.device(id, sizeof id, secret, sizeof secret)) {
        return;
    }
    HttpReply r{};
    if (!http_.checkDevice(id, secret, r) || r.status == 0) {
        return;
    }
    if (r.status == 401) {
        restart(0);
        return;
    }
    IdentityReply p;
    if (r.status == 200 && parse(r, p) && p.serverTime > 0 && timeSink_ != nullptr) {
        timeSink_->onServerTime((int64_t)p.serverTime, p.timeSynced);
        nextTimeMs_ = now + kTimeEveryMs;
    }
}

void PairingFsm::tick() {
    if (state_ == State::Paired && refreshed_ && timeSink_ != nullptr && (timeDue_ || (int32_t)(clock_.nowMs() - nextTimeMs_) >= 0)) {
        timeCheck();
        return;
    }
    if (state_ == State::Paired && !refreshed_ && (int32_t)(clock_.nowMs() - nextActionMs_) >= 0) {
        // a restart: ask once who claimed the hub and which boot the server last saw
        char id[80], secret[80];
        uint32_t now = clock_.nowMs();
        nextActionMs_ = now + 30000;
        if (!store_.device(id, sizeof id, secret, sizeof secret)) {
            restart(0);
            return;
        }
        HttpReply r{};
        if (!http_.checkDevice(id, secret, r) || r.status == 0) {
            return;
        }
        if (r.status == 401) {
            restart(0);
            return;
        }
        IdentityReply p;
        bool parsed = r.status == 200 && parse(r, p);
        if (parsed && timeSink_ != nullptr && p.serverTime > 0) {
            timeSink_->onServerTime((int64_t)p.serverTime, p.timeSynced);
            nextTimeMs_ = now + kTimeEveryMs;
        }
        if (parsed && p.hasPaired) {
            if (p.paired) {
                strncpy(claimedBy_, p.claimedBy, sizeof claimedBy_ - 1);
                strncpy(undoUntil_, p.undoUntil, sizeof undoUntil_ - 1);
                lastBoot_ = p.lastBoot < 0 ? -1 : (int64_t)p.lastBoot;
                refreshed_ = true;
            } else {
                state_ = State::Waiting;  // the claim was undone while the hub was off
                store_.setPaired(false);
                expiresAtMs_ = now + 600000u;
            }
        }
        return;
    }
    if (state_ == State::Paired || (int32_t)(clock_.nowMs() - nextActionMs_) < 0) {
        return;
    }
    if (state_ == State::Waiting) {
        poll();
    } else {
        request();
    }
}

}  // namespace melophos
