#pragma once

#include <stdint.h>

#include "hal.h"

namespace melophos {

// the buzzer: GPIO 40 through a transistor from the 5 V rail, held off at reset. Awaits a board and nothing in
// the firmware asks it for a sound yet: it is a driver other features may use. A sound nobody asked for in a
// child's bedroom is a fault, so:
//   - it is OFF by default and silent unless a stored setting turns sound on (IdentityStore::soundOn, the serial
//     command `sound on`). Without it request() makes no sound
//   - a sound is never longer than kMaxSoundMs and the next one starts no sooner than kMinGapMs after the last
//     ended, however it ended (its time ran out, the setting went off, stop()), so no caller can make a
//     continuous tone or a rattle or get round the gap by toggling the setting
//   - no caller passes a time. The driver reads one monotonic Clock itself (on the board the same source the output's
//     own timer runs from), so a stale or backwards time from a caller cannot break the gap or the duty limit
//   - the longest sound does not depend on the loop: the OUTPUT ends a sound by itself after the duration it is
//     given (on the board a one-shot esp_timer, in the host model a fake that enforces it). The driver's tick()
//     only brings its own state up to date, so a pass that blocks for seconds cannot make a sound run on
//   - the duty never goes above kMaxDutyPct of the cycle (a square wave is loudest at 50 percent) and the pitch
//     is kept between kMinHz and kMaxHz. The caller's volume (0 to 100) scales inside that limit
//   - on a board that has JTAG on GPIO 39 to 42 (not the rev A hub as built), GPIO 40 is JTAG's data out. A build for
//     such a board (MELOPHOS_JTAG) tells the driver, which then never
//     touches the pin at all, not even to silence it
class BuzzerOutput {
   public:
    virtual ~BuzzerOutput() {}
    // starts a sound that the output itself ends after durationMs, whatever the caller does or does not do
    virtual void tone(uint16_t hz, uint8_t dutyPct, uint16_t durationMs) = 0;
    // ends a sound now. Harmless when none is playing
    virtual void silence() = 0;
};

// makes an output safe to call from two threads by construction: every call takes the lock. On the board the loop
// task (tone, silence) and the esp_timer task (the timer that ends a sound) both reach the pin only through this
class SerialisedOutput : public BuzzerOutput {
   public:
    SerialisedOutput(BuzzerOutput &inner, Lock &lock) : inner_(inner), lock_(lock) {}
    void tone(uint16_t hz, uint8_t dutyPct, uint16_t durationMs) override {
        LockGuard g(lock_);
        inner_.tone(hz, dutyPct, durationMs);
    }
    void silence() override {
        LockGuard g(lock_);
        inner_.silence();
    }

   private:
    BuzzerOutput &inner_;
    Lock &lock_;
};

class Buzzer {
   public:
    static const uint16_t kMaxSoundMs = 250;
    static const uint16_t kMinGapMs = 150;
    static const uint8_t kMaxDutyPct = 30;
    static const uint16_t kMinHz = 300;
    static const uint16_t kMaxHz = 4000;

    Buzzer(BuzzerOutput &out, const Clock &clock, bool jtagClaimed) : out_(out), clock_(clock), jtag_(jtagClaimed) {}
    // the pin is made quiet. Does nothing when the pin is claimed for JTAG
    void begin();
    // the stored setting. Turning it off silences a sound in progress and that counts as the end of the sound
    void setSoundOn(bool on);
    bool soundOn() const { return on_; }
    // asks for one sound. False when it is refused: sound is off, the pin is claimed for JTAG, a sound is playing, the
    // last one ended less than kMinGapMs ago or the volume is 0
    bool request(uint16_t hz, uint16_t ms, uint8_t volumePct);
    // call every pass: brings the state up to date. The sound itself was already ended by the output
    void tick();
    void stop();
    bool sounding() const { return sounding_; }
    // true when a sound that has run its time is still marked as playing until the next tick
    void settle();
    uint32_t refused() const { return refused_; }

   private:
    BuzzerOutput &out_;
    const Clock &clock_;
    bool jtag_;
    bool on_ = false;
    bool sounding_ = false;
    uint32_t startedMs_ = 0;
    uint16_t lengthMs_ = 0;
    uint32_t endedMs_ = 0;
    bool everEnded_ = false;
    uint32_t refused_ = 0;
};

// the answer to the serial command `sound on` or `sound off`. The buzzer follows what was STORED: if the write to
// flash failed it stays off and the reply says so, because a sound that comes back after a restart or that was
// never saved, is a fault. Returns the line to print
const char *applySoundCommand(Buzzer &buzzer, bool on, bool stored);

}  // namespace melophos
