#pragma once

#include "hal.h"
#include "keymap.h"
#include "notebus.h"
#include "practice.h"
#include "render.h"

namespace melophos {

// the main loop's job as one testable object: drain the note bus, run the
// practice engine and push a frame to the strip when it changed.
//
// Latency budget, key press to light data latched (modelled, not measured):
//   transport    MIDI jack 1 ms (3 bytes at 31250 baud) | USB 1 ms poll | Bluetooth up to 15 ms interval
//   loop         up to 1 ms until the next pass
//   logic        under 0.1 ms: the work is bounded by kMaxEventsPerStep and 48 cues
//   strip out    180 LEDs x 30 us + 300 us reset = 5.7 ms
//   total        jack or USB at most 8.7 ms, Bluetooth at most 22.7 ms
// The tests hold the first three to a fake clock and charge the strip time.
// everything that wants to see each note as it leaves the bus: the session
// recorder and the MQTT note batcher
class NoteListener {
   public:
    virtual ~NoteListener() {}
    virtual void onNote(const NoteEvent &event) = 0;
};

class PracticeHub {
   public:
    static const uint8_t kMaxEventsPerStep = 32;

    PracticeHub(Clock &clock, LedSink &sink, NoteBus &bus, size_t ledCount);
    void setProfile(const KeyboardProfile &profile) { profile_ = profile; dirty_ = true; }
    // the hub is talking to the broker without TLS (a development setting). Make it
    // visible: ten keys, spread evenly along the bar, glow dim white for 2 s in every 30 s (ten is inside the strip's small-area
    // allowance, so it is one small event and not a bar-wide rise). The same ten keys light on every showing.
    // One slow on and off, never a flash and the same with reduced motion
    void setInsecure(bool on) { insecure_ = on; }
    static const size_t kBannerKeys = 10;
    // the most often the hub asks the sink to go dark at once: one a second
    static const uint32_t kDarkNowMinGapMs = 1000;
    static bool bannerOn(uint32_t nowMs) { return nowMs % 30000u < 2000u; }
    void setListener(NoteListener *listener) { listener_ = listener; }
    void setRender(const RenderSettings &s) { render_ = s; dirty_ = true; }
    // reduced motion, live: the engine and the renderer both read it on the next pass
    void setReducedMotion(bool on) {
        render_.reducedMotion = on;
        engine_.setReducedMotion(on);
        dirty_ = true;
    }
    PracticeEngine &engine() { return engine_; }
    // one pass of the main loop
    void step();
    uint32_t framesShown() const { return frames_; }
    uint32_t lastShowMs() const { return lastShowMs_; }

   private:
    Clock &clock_;
    LedSink &sink_;
    NoteBus &bus_;
    size_t leds_;
    KeyboardProfile profile_{};
    RenderSettings render_;
    PracticeEngine engine_;
    Rgb frame_[180];
    Rgb shown_[180];
    NoteListener *listener_ = nullptr;
    bool insecure_ = false;
    Mode lastMode_ = Mode::Off;
    Phase lastPhase_ = Phase::Idle;
    bool bannerWas_ = false;
    bool darkNowGiven_ = false;
    uint32_t lastDarkNowMs_ = 0;
    bool dirty_ = true;
    uint32_t frames_ = 0;
    uint32_t lastShowMs_ = 0;
};

}  // namespace melophos
