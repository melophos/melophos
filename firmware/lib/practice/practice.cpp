#include "practice.h"

#include <stdio.h>
#include <string.h>

namespace melophos {

namespace {

int32_t since(uint32_t now, uint32_t then) {
    return (int32_t)(now - then);  // survives the 32 bit millisecond counter wrapping
}

uint8_t popcount8(uint8_t v) {
    uint8_t n = 0;
    for (; v; v &= (uint8_t)(v - 1)) {
        n++;
    }
    return n;
}

}  // namespace

bool validateLesson(const Lesson &lesson, char *message, size_t cap) {
    auto no = [&](const char *why) {
        snprintf(message, cap, "%s", why);
        return false;
    };
    if (lesson.steps == nullptr || lesson.count == 0) {
        return no("the lesson has no notes");
    }
    if (lesson.count > kMaxSteps) {
        return no("the lesson is longer than 512 steps");
    }
    for (uint16_t i = 0; i < lesson.count; i++) {
        const LessonStep &s = lesson.steps[i];
        if (s.count == 0 || s.count > kMaxStepNotes) {
            return no("a step must hold 1 to 4 notes");
        }
        if (i > 0 && s.startTick <= lesson.steps[i - 1].startTick) {
            return no("steps must be in time order with no two at the same time");
        }
        for (uint8_t n = 0; n < s.count; n++) {
            if (s.notes[n] > 127) {
                return no("a lesson note is above 127");
            }
        }
    }
    return true;
}

PracticeEngine::PracticeEngine() {
    memset(pending_, 0, sizeof pending_);
}

bool PracticeEngine::start(Mode mode, const Lesson &lesson, const PracticeSettings &settings, uint32_t nowMs,
                           char *message, size_t cap) {
    if (settings.bpm < 30 || settings.bpm > 240) {
        snprintf(message, cap, "tempo must be 30 to 240 beats a minute");
        return false;
    }
    if (settings.windowMs < 50 || settings.windowMs > 500 || settings.countInBeats > 8) {
        snprintf(message, cap, "timing window must be 50 to 500 ms and the count-in 0 to 8 beats");
        return false;
    }
    if (mode != Mode::Off && !validateLesson(lesson, message, cap)) {
        return false;
    }
    mode_ = mode;
    settings_ = settings;
    lesson_ = mode == Mode::Off ? Lesson{nullptr, 0} : lesson;
    score_ = Score{};
    first_ = 0;
    eventCount_ = 0;
    edgeSet_ = false;
    startMs_ = nowMs;
    for (uint16_t i = 0; i < lesson_.count; i++) {
        uint8_t mask = 0;
        for (uint8_t n = 0; n < lesson_.steps[i].count; n++) {
            mask |= (uint8_t)(1u << n);
        }
        pending_[i] = mask;
    }
    phase_ = mode == Mode::Off ? Phase::Running : (mode == Mode::Rhythm && settings.countInBeats ? Phase::CountIn : Phase::Running);
    if (mode == Mode::Listen) {
        phase_ = Phase::Running;
    }
    return true;
}

void PracticeEngine::stop() {
    mode_ = Mode::Off;
    phase_ = Phase::Idle;
    lesson_ = Lesson{nullptr, 0};
    eventCount_ = 0;
}

// rhythm and listen share one clock: the count-in, then ticks at the tempo
uint32_t PracticeEngine::targetMs(uint16_t step) const {
    uint32_t countIn = mode_ == Mode::Rhythm ? (uint32_t)settings_.countInBeats * 60000u / settings_.bpm : 0;
    return startMs_ + countIn + (uint32_t)lesson_.steps[step].startTick * 15000u / settings_.bpm;
}

uint8_t PracticeEngine::countInRemaining(uint32_t nowMs) const {
    if (phase_ != Phase::CountIn) {
        return 0;
    }
    uint32_t beatMs = 60000u / settings_.bpm;
    int32_t left = since(startMs_ + settings_.countInBeats * beatMs, nowMs);
    return left <= 0 ? 0 : (uint8_t)((left + (int32_t)beatMs - 1) / (int32_t)beatMs);
}

void PracticeEngine::addEvent(uint8_t note, LightRole role, uint32_t nowMs, bool blink) {
    if (eventCount_ == kMaxEvents) {
        // the oldest goes: a flood of keys cannot grow the list
        memmove(&events_[0], &events_[1], sizeof(Cue) * (kMaxEvents - 1));
        eventCount_--;
    }
    events_[eventCount_++] = Cue{note, role, 0, false, blink, nowMs};
}

void PracticeEngine::removePlayed(uint8_t note) {
    for (size_t i = 0; i < eventCount_;) {
        if (events_[i].role == LightRole::Played && events_[i].note == note) {
            memmove(&events_[i], &events_[i + 1], sizeof(Cue) * (eventCount_ - i - 1));
            eventCount_--;
        } else {
            i++;
        }
    }
}

void PracticeEngine::resolveOverdue(uint32_t nowMs) {
    while (first_ < lesson_.count) {
        if (pending_[first_] == 0) {
            first_++;
            continue;
        }
        if (since(nowMs, targetMs(first_)) > (int32_t)settings_.windowMs) {
            score_.missed = (uint16_t)(score_.missed + popcount8(pending_[first_]));
            pending_[first_] = 0;
            first_++;
            continue;
        }
        break;
    }
}

void PracticeEngine::onNote(const NoteEvent &event) {
    if (event.note > 127) {
        return;
    }
    if (event.velocity == 0) {
        removePlayed(event.note);
        return;
    }
    uint32_t now = event.timeMs;
    if (mode_ == Mode::Off || mode_ == Mode::Listen || phase_ == Phase::Idle || phase_ == Phase::Done) {
        removePlayed(event.note);
        addEvent(event.note, LightRole::Played, now, false);
        return;
    }
    // a note either answers a pending note of a step whose turn has come or it is wrong
    bool matched = false;
    if (mode_ == Mode::Melody) {
        if (first_ < lesson_.count) {
            for (uint8_t n = 0; n < lesson_.steps[first_].count && !matched; n++) {
                if ((pending_[first_] & (1u << n)) && lesson_.steps[first_].notes[n] == event.note) {
                    pending_[first_] = (uint8_t)(pending_[first_] & ~(1u << n));
                    matched = true;
                    score_.hits++;
                }
            }
        }
    } else {
        resolveOverdue(now);
        for (uint16_t i = first_; i < lesson_.count && !matched; i++) {
            int32_t dt = since(now, targetMs(i));
            if (dt < -(int32_t)settings_.windowMs) {
                break;  // later steps are further away still
            }
            if (dt > (int32_t)settings_.windowMs) {
                continue;
            }
            for (uint8_t n = 0; n < lesson_.steps[i].count && !matched; n++) {
                if ((pending_[i] & (1u << n)) && lesson_.steps[i].notes[n] == event.note) {
                    pending_[i] = (uint8_t)(pending_[i] & ~(1u << n));
                    matched = true;
                    if (dt < -(int32_t)(settings_.windowMs / 2)) {
                        score_.early++;
                    } else if (dt > (int32_t)(settings_.windowMs / 2)) {
                        score_.late++;
                    } else {
                        score_.hits++;
                    }
                }
            }
        }
    }
    if (matched) {
        // a right note puts its light out: the guide for it is gone and nothing replaces it
        removePlayed(event.note);
        if (mode_ == Mode::Melody) {
            while (first_ < lesson_.count && pending_[first_] == 0) {
                first_++;
            }
            if (first_ >= lesson_.count) {
                phase_ = Phase::Done;
            }
        } else {
            resolveOverdue(now);
        }
        return;
    }
    score_.wrong++;
    // a warning may only start 500 ms after the previous one's last light-up
    // (1000 ms after a blinking one started). That keeps the rising edges of
    // wrong lights at least 500 ms apart across the whole bar: 2 a second at
    // most. A wrong note inside that gap is scored but not lit again.
    bool allowed = !edgeSet_ || since(now, nextWrongMs_) >= 0;
    if (!allowed) {
        score_.wrongUnlit++;
        return;
    }
    bool blink = !settings_.reducedMotion;
    nextWrongMs_ = now + (blink ? timing::kWrongBlinkPeriodMs * 2 : timing::kWrongBlinkPeriodMs);
    edgeSet_ = true;
    addEvent(event.note, LightRole::Wrong, now, blink);
}

void PracticeEngine::tick(uint32_t nowMs) {
    if (phase_ == Phase::Idle) {
        return;
    }
    // wrong cues end by themselves
    for (size_t i = 0; i < eventCount_;) {
        const Cue &c = events_[i];
        uint32_t life = c.blink ? timing::kWrongBlinkTotalMs : timing::kWrongSteadyMs;
        if (c.role == LightRole::Wrong && since(nowMs, c.startMs) >= (int32_t)life) {
            memmove(&events_[i], &events_[i + 1], sizeof(Cue) * (eventCount_ - i - 1));
            eventCount_--;
        } else {
            i++;
        }
    }
    if (mode_ == Mode::Rhythm) {
        if (phase_ == Phase::CountIn && since(nowMs, startMs_) >= (int32_t)((uint32_t)settings_.countInBeats * 60000u / settings_.bpm)) {
            phase_ = Phase::Running;
        }
        resolveOverdue(nowMs);
        if (first_ >= lesson_.count && phase_ == Phase::Running) {
            phase_ = Phase::Done;
        }
    } else if (mode_ == Mode::Listen && lesson_.count > 0) {
        uint32_t end = targetMs((uint16_t)(lesson_.count - 1)) + 60000u / settings_.bpm;
        if (since(nowMs, end) >= 0) {
            phase_ = Phase::Done;
        }
    }
}

void PracticeEngine::collect(uint32_t nowMs, CueList &out) const {
    out.count = 0;
    auto push = [&](uint8_t note, LightRole role, uint8_t lead, bool blink, uint32_t start, bool left = false) {
        if (out.count < kMaxCues) {
            out.cue[out.count++] = Cue{note, role, lead, left, blink, start};
        }
    };
    auto isLeft = [&](uint16_t step, uint8_t n) { return (lesson_.steps[step].leftMask >> n) & 1u; };
    for (size_t i = 0; i < eventCount_; i++) {
        push(events_[i].note, events_[i].role, 0, events_[i].blink, events_[i].startMs, false);
    }
    if (external_) {
        for (int note = 0; note < 128; note++) {
            if (external_->test((uint8_t)note)) {
                push((uint8_t)note, LightRole::Guide, 0, false, nowMs);
            }
        }
    }
    if (phase_ == Phase::Done || phase_ == Phase::Idle || mode_ == Mode::Off) {
        return;
    }
    if (mode_ == Mode::Melody) {
        for (uint8_t n = 0; n < lesson_.steps[first_].count; n++) {
            if (pending_[first_] & (1u << n)) {
                push(lesson_.steps[first_].notes[n], LightRole::Guide, 0, false, nowMs, isLeft(first_, n));
            }
        }
        if (first_ + 1 < lesson_.count) {
            for (uint8_t n = 0; n < lesson_.steps[first_ + 1].count; n++) {
                push(lesson_.steps[(uint16_t)(first_ + 1)].notes[n], LightRole::Upcoming, 0, false, nowMs, isLeft((uint16_t)(first_ + 1), n));
            }
        }
        return;
    }
    if (mode_ == Mode::Listen) {
        for (uint16_t i = 0; i < lesson_.count; i++) {
            uint32_t t = targetMs(i);
            uint32_t endMs = i + 1 < lesson_.count ? targetMs((uint16_t)(i + 1)) - timing::kListenGapMs
                                                   : t + 60000u / settings_.bpm;
            if (since(nowMs, t) >= 0 && since(nowMs, endMs) < 0) {
                for (uint8_t n = 0; n < lesson_.steps[i].count; n++) {
                    push(lesson_.steps[i].notes[n], LightRole::Guide, 0, false, t, isLeft(i, n));
                }
            } else if (since(nowMs, t) < 0 && since(t, nowMs) <= (int32_t)timing::kLookaheadMs) {
                for (uint8_t n = 0; n < lesson_.steps[i].count; n++) {
                    push(lesson_.steps[i].notes[n], LightRole::Upcoming, 0, false, nowMs, isLeft(i, n));
                }
                break;
            }
        }
        return;
    }
    // rhythm: guide for steps whose window is open, the approach for the next one
    bool upcomingDone = false;
    for (uint16_t i = first_; i < lesson_.count; i++) {
        int32_t until = since(targetMs(i), nowMs);  // positive while the target is ahead
        if (until > (int32_t)settings_.windowMs) {
            if (!upcomingDone && until <= (int32_t)timing::kLookaheadMs + (int32_t)settings_.windowMs) {
                uint8_t lead = 0;
                if (!settings_.reducedMotion) {
                    // 3 LEDs out at the start of the approach, one hop every 500 ms
                    int32_t left = until - (int32_t)settings_.windowMs;
                    lead = left > 1000 ? 3 : (left > 500 ? 2 : (left > 0 ? 1 : 0));
                }
                for (uint8_t n = 0; n < lesson_.steps[i].count; n++) {
                    if (pending_[i] & (1u << n)) {
                        push(lesson_.steps[i].notes[n], LightRole::Upcoming, lead, false, nowMs, isLeft(i, n));
                    }
                }
                upcomingDone = true;
            }
            break;
        }
        for (uint8_t n = 0; n < lesson_.steps[i].count; n++) {
            if (pending_[i] & (1u << n)) {
                push(lesson_.steps[i].notes[n], LightRole::Guide, 0, false, nowMs, isLeft(i, n));
            }
        }
    }
}

}  // namespace melophos
