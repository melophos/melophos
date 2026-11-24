#include "hub.h"

#include <string.h>

namespace melophos {

PracticeHub::PracticeHub(Clock &clock, LedSink &sink, NoteBus &bus, size_t ledCount)
    : clock_(clock), sink_(sink), bus_(bus), leds_(ledCount > 180 ? 180 : ledCount) {
    memset(frame_, 0, sizeof frame_);
    memset(shown_, 0, sizeof shown_);
}

void PracticeHub::step() {
    uint32_t now = clock_.nowMs();
    NoteEvent event;
    for (uint8_t n = 0; n < kMaxEventsPerStep && bus_.pop(event); n++) {
        engine_.onNote(event);
        if (listener_) {
            listener_->onNote(event);
        }
    }
    engine_.tick(now);
    CueList cues;
    engine_.collect(now, cues);
    RenderSettings settings = render_;
    settings.reducedMotion = settings.reducedMotion || engine_.reducedMotion();
    renderFrame(profile_, cues, now, settings, frame_, leds_);
    bool banner = insecure_ && bannerOn(now);
    if (banner) {
        // ten keys, evenly spread, never the whole bar: a banner that lit 180 keys for 2 s every 30 s was a large regular
        // rise. Ten is inside the strip's small-area allowance
        for (size_t k = 0; k < kBannerKeys && leds_ > 0; k++) {
            size_t i = (k * leds_ + leds_ / 2) / kBannerKeys;
            if (i < leds_ && frame_[i].r == 0 && frame_[i].g == 0 && frame_[i].b == 0) {
                frame_[i] = Rgb{60, 60, 60};
            }
        }
    }
    // a stop, a mode change, the end of a lesson and the end of the banner go dark at once: the guard skips its fall
    // queue for them (and nothing else: see OutputGuard::darkNow)
    Mode mode = engine_.mode();
    Phase phase = engine_.phase();
    if (mode != lastMode_ || (phase == Phase::Done && lastPhase_ != Phase::Done) || (bannerWas_ && !banner)) {
        // at most one darkNow a second whatever asks (a mode change from the Studio, MQTT or Bluetooth later on can come
        // as fast as a caller likes): inside that second the change still happens and its lights simply fall through
        // the guard's fall queue like any others
        if (!darkNowGiven_ || (uint32_t)(now - lastDarkNowMs_) >= kDarkNowMinGapMs) {
            sink_.darkNow();
            darkNowGiven_ = true;
            lastDarkNowMs_ = now;
        }
    }
    lastMode_ = mode;
    lastPhase_ = phase;
    bannerWas_ = banner;
    // the sink is the last step: the flash limit and the current ceiling live there, not here
    if (dirty_ || sink_.pending() || memcmp(frame_, shown_, leds_ * sizeof(Rgb)) != 0) {
        sink_.show(frame_, leds_);  // blocks for the strip's output time
        memcpy(shown_, frame_, leds_ * sizeof(Rgb));
        dirty_ = false;
        frames_++;
        lastShowMs_ = now;
    }
}

}  // namespace melophos
