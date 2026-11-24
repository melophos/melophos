#include "netctl.h"

#include <stdio.h>

namespace melophos {

void NetworkController::begin() {
    BootStart b = peekBoot(counter_);
    boot_ = b.boot;
    bootLost_ = b.kind == BootStart::Lost;
    if (bootLost_) {
        platform_.say("boot: the boot counter is lost: nothing will be published until the hub is re-paired or its secret rotated");
    }
}

void NetworkController::closeLink() {
    if (link_ != nullptr) {
        platform_.closeLink(link_);
        link_ = nullptr;
    }
}

void NetworkController::showCode() {
    if (pairing_.code()[0] == '\0') {
        return;
    }
    uint32_t now = clock_.nowMs();
    if (!codeShown_ || now - lastCodeMs_ > 15000) {
        codeShown_ = true;
        lastCodeMs_ = now;
        char line[120];
        snprintf(line, sizeof line, "pairing: type %s into the Studio. Anyone who reads this code can claim the hub", pairing_.code());
        platform_.say(line);
    }
}

void NetworkController::warn(const char *text) {
    uint32_t now = clock_.nowMs();
    if (!warned_ || now - lastWarnMs_ > 60000) {
        warned_ = true;
        lastWarnMs_ = now;
        platform_.say(text);
    }
}

void NetworkController::step(bool wifiUp) {
    uint32_t now = clock_.nowMs();
    // storage is read once a second, not on every 20 ms pass
    if (!readyKnown_ || now - readyAtMs_ >= 1000) {
        ready_ = identity_.readyForTls() || identity_.readyInsecure();
        readyKnown_ = true;
        readyAtMs_ = now;
    }
    if (!wifiUp) {
        return;
    }
    char id[70], secret[70];
    bool haveIdentity = identity_.device(id, sizeof id, secret, sizeof secret);
    if (unclaim_) {
        unclaim_ = false;
        platform_.say(pairing_.unclaim() ? "unclaim: the claim was removed, the hub pairs again as a new device"
                                         : "unclaim: the server did not remove the claim (it can only be undone within 15 minutes)");
        closeLink();
        claimShown_ = false;
        haveIdentity = identity_.device(id, sizeof id, secret, sizeof secret);
    }
    if (!started_) {
        pairing_.begin();  // a restart: carry on from what storage says and load the hour's request count
        started_ = true;
    }
    if (!haveIdentity) {
        if (pairing_.state() == PairingFsm::State::Paired) {
            pairing_.begin();
        }
        closeLink();
        claimShown_ = false;
        if (bootLost_) {
            // a new identity is a new device: the server lets it start anywhere up to 1 000 000
            uint32_t n = counter_.next();
            if (n != 0) {
                boot_ = n;
                bootLost_ = false;
            }
        }
        pairing_.tick();
        showCode();
        return;
    }
    pairing_.tick();
    if (pairing_.state() != PairingFsm::State::Paired) {
        showCode();  // no broker login exists until the server says paired, so the hub does not even try
        return;
    }
    if (!pairing_.refreshed()) {
        return;  // still asking the server who claimed it and which boot it saw last
    }
    if (!claimShown_ && pairing_.claimedBy()[0] != '\0') {
        claimShown_ = true;
        // the longest name and time the pairing state can hold both fit, so the warning is never cut short
        char line[256];
        snprintf(line, sizeof line, "pairing: this hub was claimed by %s. If that is not you, send 'unclaim' within 15 minutes (until %s)",
                 pairing_.claimedBy(), pairing_.undoUntil());
        platform_.say(line);
    }
    if (bootLost_) {
        warn("boot: this hub's boot counter was lost, so it will not publish until the owner re-pairs it (factory-reset) or rotates its secret in the Studio");
        return;
    }
    outOfRange_ = !bootInRange(boot_, pairing_.lastBoot());
    if (outOfRange_) {
        char line[260];
        snprintf(line, sizeof line,
                 "boot: this hub's boot number %lu is out of the server's range (it last saw %lld), so nothing is published. Re-pair it (factory-reset) or have the owner rotate its secret in the Studio",
                 (unsigned long)boot_, (long long)pairing_.lastBoot());
        warn(line);
        return;
    }
    if (!ready_) {
        return;
    }
    if (link_ == nullptr) {
        char host[70];
        uint16_t port;
        if (!identity_.broker(host, sizeof host, port)) {
            return;
        }
        link_ = platform_.openLink(host, port, id, secret, boot_, this);
        if (link_ == nullptr) {
            return;
        }
    }
    if (clearStale_) {
        clearStale_ = false;
        char line[96];
        snprintf(line, sizeof line, "queue: %lu held session(s) with a date the server would skip were dropped", (unsigned long)link_->clearStale());
        platform_.say(line);
    }
    link_->setStatus(platform_.status());
    link_->pump();
    bool up = link_->connected();
    if (up && !wasUp_) {
        pairing_.requestTimeCheck();  // every reconnect asks the server for the time
    }
    wasUp_ = up;
    everConnected_ = link_->everConnected();
    if (link_->loginRefusals() >= 2) {
        // the login is wrong, removed or the hub was un-claimed: treat it like a 401
        platform_.say("mqtt: the broker refuses this hub's login, so pairing starts again");
        pairing_.onUnauthorised();
        closeLink();
    }
}

}  // namespace melophos
