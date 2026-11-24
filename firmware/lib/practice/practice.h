#pragma once

#include <stddef.h>
#include <stdint.h>

#include "notebus.h"

namespace melophos {

enum class LightRole : uint8_t { Played, Guide, Upcoming, Wrong };
enum class Mode : uint8_t { Off, Melody, Rhythm, Listen };
enum class Phase : uint8_t { Idle, CountIn, Running, Done };

const size_t kMaxStepNotes = 4;
const size_t kMaxSteps = 512;
const size_t kMaxEvents = 16;  // played and wrong cues kept at once
const size_t kMaxCues = 48;

// one moment in a piece: up to four notes sounding together. startTick counts
// sixteenth notes (a quarter of a beat) from the start of the piece.
struct LessonStep {
    uint16_t startTick;
    uint8_t count;
    uint8_t notes[kMaxStepNotes];
    uint8_t leftMask;  // bit n set: note n of the step is for the left hand (0 means all right hand)
};

struct Lesson {
    const LessonStep *steps;
    uint16_t count;
};

// refuses a lesson that came from outside and would index out of range.
bool validateLesson(const Lesson &lesson, char *message, size_t cap);

struct PracticeSettings {
    uint16_t bpm = 80;           // 30 to 240
    uint16_t windowMs = 200;     // rhythm: accepted distance from the target, 50 to 500
    uint8_t countInBeats = 4;    // rhythm: 0 to 8
    bool reducedMotion = false;  // no pulse, no blink and no moving dot
};

struct Score {
    uint16_t hits;    // on time: within half the window
    uint16_t early;
    uint16_t late;
    uint16_t missed;
    uint16_t wrong;
    uint16_t wrongUnlit;  // wrong notes scored but not lit, inside the 2 a second limit
};

// what one LED should show. Colour is chosen by the renderer: the engine only
// says what the light means, where it is and how old it is.
struct Cue {
    uint8_t note;
    LightRole role;
    uint8_t lead;  // upcoming only: LEDs behind the target, 0 when it has arrived
    bool left;     // guide and upcoming: the left hand (blue). Otherwise the right hand (amber)
    bool blink;    // wrong only: false when another blink is still running
    uint32_t startMs;
};

struct CueList {
    Cue cue[kMaxCues];
    size_t count;
};

namespace timing {
const uint32_t kWrongBlinkPeriodMs = 500;  // 2 flashes a second, under the 3 a second limit
const uint32_t kWrongBlinkTotalMs = 750;   // two flashes then dark
const uint32_t kWrongSteadyMs = 800;       // reduced motion or a second wrong note while one blinks
const uint32_t kLookaheadMs = 1500;        // rhythm: the approach starts this long before the target
const uint32_t kListenGapMs = 40;          // listen: dark gap between two consecutive steps
}  // namespace timing

// Melody waits for each right note. Rhythm holds a tempo and scores timing.
// Listen plays the guide by itself. Off is free play: only played keys light.
class PracticeEngine {
   public:
    PracticeEngine();
    // false (with the reason) when the lesson or settings are out of bounds
    bool start(Mode mode, const Lesson &lesson, const PracticeSettings &settings, uint32_t nowMs, char *message,
               size_t cap);
    void stop();
    void onNote(const NoteEvent &event);
    void tick(uint32_t nowMs);
    // lights a host asked for (Synthesia over Bluetooth): shown as guides in any mode
    void setExternalGuides(const GuideSet *guides) { external_ = guides; }
    void collect(uint32_t nowMs, CueList &out) const;

    Mode mode() const { return mode_; }
    Phase phase() const { return phase_; }
    const Score &score() const { return score_; }
    uint16_t stepIndex() const { return first_; }
    bool reducedMotion() const { return settings_.reducedMotion; }
    void setReducedMotion(bool on) { settings_.reducedMotion = on; }
    // beats of count-in still to go (rhythm), for a click or a screen
    uint8_t countInRemaining(uint32_t nowMs) const;

   private:
    Mode mode_ = Mode::Off;
    Phase phase_ = Phase::Idle;
    Lesson lesson_{nullptr, 0};
    PracticeSettings settings_;
    Score score_{};
    uint32_t startMs_ = 0;
    uint16_t first_ = 0;                // earliest step not yet resolved
    uint8_t pending_[kMaxSteps];        // bit i set: note i of the step is still to be played
    Cue events_[kMaxEvents];              // played and wrong cues
    size_t eventCount_ = 0;
    const GuideSet *external_ = nullptr;
    uint32_t nextWrongMs_ = 0;
    bool edgeSet_ = false;

    uint32_t targetMs(uint16_t step) const;
    void addEvent(uint8_t note, LightRole role, uint32_t nowMs, bool blink);
    void removePlayed(uint8_t note);
    void resolveOverdue(uint32_t nowMs);
};

}  // namespace melophos
