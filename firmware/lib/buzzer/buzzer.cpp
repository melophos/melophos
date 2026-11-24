#include "buzzer.h"

namespace melophos {

void Buzzer::begin() {
    if (!jtag_) {
        out_.silence();
    }
}

void Buzzer::setSoundOn(bool on) {
    on_ = on;
    if (!on) {
        stop();
    }
}

void Buzzer::settle() {
    uint32_t nowMs = clock_.nowMs();
    if (sounding_ && (uint32_t)(nowMs - startedMs_) >= lengthMs_) {
        out_.silence();
        sounding_ = false;
        endedMs_ = startedMs_ + lengthMs_;  // when it really ended, not when the loop noticed
        everEnded_ = true;
    }
}

bool Buzzer::request(uint16_t hz, uint16_t ms, uint8_t volumePct) {
    settle();
    uint32_t nowMs = clock_.nowMs();
    if (!on_ || jtag_ || sounding_ || volumePct == 0 || ms == 0) {
        refused_++;
        return false;
    }
    if (everEnded_ && (uint32_t)(nowMs - endedMs_) < kMinGapMs) {
        refused_++;
        return false;
    }
    if (hz < kMinHz) {
        hz = kMinHz;
    }
    if (hz > kMaxHz) {
        hz = kMaxHz;
    }
    if (ms > kMaxSoundMs) {
        ms = kMaxSoundMs;
    }
    if (volumePct > 100) {
        volumePct = 100;
    }
    uint8_t duty = (uint8_t)((uint32_t)volumePct * kMaxDutyPct / 100u);
    if (duty == 0) {
        duty = 1;
    }
    out_.tone(hz, duty, ms);
    sounding_ = true;
    startedMs_ = nowMs;
    lengthMs_ = ms;
    return true;
}

void Buzzer::tick() {
    settle();
}

void Buzzer::stop() {
    settle();
    uint32_t nowMs = clock_.nowMs();
    if (sounding_) {
        out_.silence();
        sounding_ = false;
        endedMs_ = nowMs;  // every way a sound ends records its end, so the gap holds
        everEnded_ = true;
    }
}

const char *applySoundCommand(Buzzer &buzzer, bool on, bool stored) {
    if (on) {
        if (!stored) {
            buzzer.setSoundOn(false);
            return "sound: the setting could not be saved to flash, so sound stays off";
        }
        buzzer.setSoundOn(true);
        return "sound: on. Nothing asks for a sound yet";
    }
    buzzer.setSoundOn(false);  // off at once, whatever the flash says
    return stored ? "sound: off" : "sound: off now, but the setting could not be cleared in flash, so it may come back after a restart";
}

}  // namespace melophos
