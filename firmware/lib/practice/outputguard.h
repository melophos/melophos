#pragma once

#include "hal.h"
#include "render.h"

namespace melophos {

// the last step before the strip. Whatever produced a frame (a note, a lesson, a Bluetooth host, the
// insecure-mode glow) it passes through here, so no source and no overlay can get round the rules.
//
//   Each light   no LED goes from off to on more than 3 times in any one second and none makes more than 3
//                large brightness rises. "Large" follows the general flash definition: a change in relative
//                luminance of 10 per cent of full white or more (100 of 1000), where the darker state is
//                under 0.80 (always true here: the drive is at most half scale). A fall that would leave no
//                rise to spare is refused and the light is HELD at its brighter state until the oldest rise
//                is a second old.
//   The strip    the general definition exempts a small area. The allowance here is 10 LEDs (kAreaAllowance).
//                Derivation, approximate until measured: the rule exempts a flash covering under a quarter of
//                a 10 degree field of view. At the keyboard, about 0.4 m from the bar, 10 degrees is a disc
//                70 mm across, 3850 mm2, so a quarter is 960 mm2. One key's lit diffuser is about 100 mm2,
//                so about 10 keys. Changes inside that allowance pass under the per-light rule alone, which
//                is why one key or a chord lights at once. Beyond it two limits apply to the strip as a
//                whole, counted over ANY one second and summed across groups, so small groups taking turns
//                cannot add up to a bar-wide flicker:
//                  * at most 3 x 10 = 30 lights go out in a second (a light that is held lit is not
//                    dark, so it cannot rise again: bounding the falls bounds the flicker),
//                  * the strip's total luminance makes at most 2 large rises a second (the owner's ruling, so a
//                    whole-bar flash happens at most twice a second), where large is
//                    10 LEDs x 10 per cent = 1000 thousandths of one white LED.
//                When either would be exceeded the lights that would fall stay as they were: steady.
//   Outputs      three outputs (keys, frets, aux) are one frame here, so the ceiling and every limit below are totals
//                over all of them. Awaits a board: nothing has driven the second and third output yet.
//   Floor        a lit light is never scaled to dark: it keeps level 1 of its strongest channel. The floor is part of the
//                draw, so the scale is the LARGEST one at which the frame WITH the floor fits (a search, in applyCeiling),
//                settled BEFORE the per-light and strip rules run and a steady frame stays steady. On the hub board
//                the idle draw is 480 mA (all 480 lights counted) and each lit light at level 1 adds 20/255 mA, so all
//                390 lights that can be lit stay lit from a ceiling of 511 mA up. The lowest ceiling the firmware sets
//                is 512 mA (the 2.5 A supply setting), so the floor always fits and no light is ever put out by the
//                ceiling. Under 511 mA (never set) the ceiling would win and lights would go dark from the highest
//                index first. That and a ceiling of 0, are the only cases in which the guard shows a frame its rules
//                did not judge.
//   Holds        a light that a rule holds stays as it was SHOWN. A hold can carry brightness from a higher ceiling,
//                more than the new one allows. The guard then RELEASES it through the rules before it touches the
//                scale: the held lights are lowered (they stay lit, only dimmer) as far as the ceiling needs, so
//                the requested lights keep the scale they were given and a steady frame does not dim when the
//                ceiling falls. Only if even floor level holds do not fit is the scale lowered too. Rules are run
//                again from the same state at each trial, so what they judged is what is shown and every
//                tracker (each light's and the strip's) learns the frame that was actually sent.
//   Rises        a forced fall (the ceiling's) is not one the guard chose. A light that fell by force could rise
//                again at once. So rises are also limited directly: a light or the strip's total, that has made 3
//                large rises in the last second is cut back to just under a large rise above its low state.
//   Off to on    each light is also limited directly to 3 off-to-on changes in any second, whatever darkened it (a
//                forced fall, a ceiling of 0, a mode change): with 3 in the window it stays DARK until the oldest is a
//                second old. A key that has not been lit lately lights at once. The strip's own limit on rises is the one
//                on its total luminance (2 large rises a second), which every light coming on adds to.
//   Re-lights    the strip counts lights that come on within a second of going dark: at most 30 in any second across
//                all outputs (3 x 10, the same area allowance as the falls), to the light that has been dark longest.
//                A light dark for more than a second is free, so a lesson start is not starved: after a stop of under a
//                second only 30 guides come at once and the rest follow in under a second. This count is what makes
//                darkNow safe. The strip's luminance limit cannot see one group of lights rising while another falls
//                with the total level, so two halves of the bar could swap at 3 Hz with every other limit passing.
//   Dark at once darkNow() skips the fall queue (the 30 falls a second) for the next frame. It is used by a stop, a mode
//                change, the end of a lesson and the end of the insecure-mode banner (lib/practice/hub.cpp). The guard honours it
//                at most once a second, whatever calls it (a call inside the second falls through the normal fall queue);
//                the hub keeps its own once-a-second check too, for a sink that is not the guard. It bypasses that queue and nothing else: every
//                change is still counted, every light's later relight counts against its 3 off-to-on changes and
//                against the strip's 30 re-lights and the holds, the rise limits and the ceiling still apply. Without
//                the queue falls are not capped, so what stops a flash is that a light cannot come back: it is limited
//                per light (3 a second) and across the strip (30 re-lights a second). The supply ceiling is held at 0
//                for at least 1 s after the inlet drops and the inlet counts as back only after 500 ms of steady
//                reading (InletGate) and the audio gate reads the same gate.
//   Waiting      lights asked dark share the fall budget oldest first, so none is starved by busier ones. The most a
//                light can be kept lit after it was asked dark is kFallWaitBoundMs: about 2 seconds with fewer than
//                30 waiting, 14 seconds with all 390 asked at once.
//   No supply    at a ceiling of 0 (the inlet dropped, the strip has no supply) every light goes dark at once. That
//                forced fall is counted and not limited, on purpose: there is nothing to show and holding a light
//                lit would draw current the supply cannot give. When the supply returns the lights rise from dark as
//                a fresh start, each within the per-light off-to-on limit.
//   Current      the ceiling is applied inside the guard, to the frame that is then judged, so scaling cannot
//                create a swing. The scale drops at once when the current would exceed the ceiling and
//                rises again only once a second, in one step. A change of ceiling is shown at the next
//                pass even if the frame has not changed.
class OutputGuard : public LedSink {
   public:
    static const uint32_t kWindowMs = 1000;
    static const int kMaxRises = 3;
    // the strip as a whole: at most 2 large rises of its total luminance in any second (the owner's ruling), so a whole-bar
    // flash cannot happen more than twice a second. Each light keeps its 3
    static const int kMaxStripRises = 2;
    static const uint16_t kLargeSwing = 100;        // 10 per cent of full white, in thousandths
    static const int kAreaAllowance = 10;           // LEDs
    // 30 falls a second: the general rule allows 3 flashes a second and a flash is one fall, so 3 flashes of an
    // area as large as the allowance (10 LEDs) is 3 x 10 = 30 lights going out in a second
    static const int kMaxFallsPerSecond = 3 * kAreaAllowance;
    // the strip's total luminance counts a large rise at 10 LEDs x 10 per cent of one white LED
    static const int32_t kStripSwing = kAreaAllowance * kLargeSwing;
    static const uint32_t kScaleRaiseMs = 1000;
    // re-lights: a light that comes on within one second of going dark. At most 30 a second across all outputs, the same
    // 3 x 10 area allowance as the falls. A light that has been dark for more than a second is free, so a lesson start
    // is not starved. This is what stops two groups of lights swapping on and off against each other with the total
    // level (the strip's luminance limit cannot see one group rising while another falls) when darkNow lets falls go at once
    static const int kMaxRelightsPerSecond = 3 * kAreaAllowance;
    // the most often darkNow is honoured: once a second. The guard is the last step, so the limit is here and holds
    // whatever calls it (a hub, a lesson, a remote command)
    static const uint32_t kDarkNowMinGapMs = 1000;
    // after power-on every output stays dark this long. The hub's 5 V switch can take up to 252 ms to turn fully on
    // (simulated), and a load drawn before then makes it carry the LED current while only partly on. Twice that
    static const uint32_t kPowerOnHoldMs = 500;
    // how long a light that was asked dark can be kept lit by the fall budget. The budget goes to the light that has
    // waited longest, so with `waiting` lights asked dark at once the last goes dark after waiting / 30 seconds
    // (rounded up), plus one second for a hold by the light's own rules or the strip's. Fewer than 30 waiting:
    // about 2 seconds. All 390 at once: 14 seconds
    static uint32_t kFallWaitBoundMs(size_t waiting) { return (uint32_t)(((waiting + kMaxFallsPerSecond - 1) / kMaxFallsPerSecond + 1) * 1000u); }

    OutputGuard(Clock &clock, LedSink &downstream, uint16_t ceilingMa = kLedCurrentCeilingMa)
        : clock_(clock), down_(downstream), supplyCeilingMa_(ceilingMa) {
        stripSwing_.cap = kMaxStripRises;
    }
    void show(const Rgb *pixels, size_t count) override;
    // keeps every output dark until the clock reaches holdMs, counted from power-on. Set once at start-up. A frame
    // shown during the hold is not kept: the first frame after it is the one that lights
    void setPowerOnHold(uint32_t holdMs) {
        holdUntilMs_ = holdMs;
        holding_ = holdMs > 0;
    }
    bool holding() const { return holding_; }
    // the hub drives three outputs (keys, frets, aux). They are ONE frame to the guard, in that order: the
    // ceiling is a total over every light on every output. The flash limits count across all of them
    // together, since the lights are seen together. With a layout set, show() is the key output alone and the
    // others are dark. Without one (the default) the frame is whatever is passed, as before
    // aux is the MAXIMUM length of the third output: its idle draw is always counted. The length in use is
    // setAuxInUse and only that many lights are ever lit
    void setLayout(size_t keys, size_t frets, size_t aux) {
        keys_ = keys > kGuardLeds ? kGuardLeds : keys;
        frets_ = keys_ + frets > kGuardLeds ? kGuardLeds - keys_ : frets;
        aux_ = keys_ + frets_ + aux > kGuardLeds ? kGuardLeds - keys_ - frets_ : aux;
        auxInUse_ = aux_;
    }
    void setAuxInUse(size_t n) { auxInUse_ = n > aux_ ? aux_ : n; }
    size_t auxInUse() const { return auxInUse_; }
    size_t layoutTotal() const { return keys_ + frets_ + aux_; }
    void showOutputs(const Rgb *keys, size_t nKeys, const Rgb *frets, size_t nFrets, const Rgb *aux, size_t nAux);
    // true while the guard holds something back or has not yet reached the ceiling it was given
    bool pending() const override { return held_ || reshow_; }
    // the ceiling the supply allows (see ledCeilingForSupply). Never above the board's own figure
    void setSupplyCeiling(uint16_t ceilingMa) {
        uint16_t c = ceilingMa > kLedCurrentCeilingMa ? kLedCurrentCeilingMa : ceilingMa;
        reshow_ = reshow_ || c != supplyCeilingMa_;
        supplyCeilingMa_ = c;
    }
    // for tests and diagnostics: the limits can be switched off to prove the tests need them
    // the next frame's falls skip the fall queue (the 30 a second): a stop, a mode change, the end of a lesson and the end
    // of the insecure-mode banner use it. It bypasses that queue and nothing else: every change is still counted and every
    // later relight still counts against each light's 3 off-to-on changes and the strip's 30 (so lights cannot relight
    // inside the window) and the rise limits and holds still apply
    void darkNow() override { immediateDark_ = true; reshow_ = true; }
    void setSwingLimit(bool on) { swingLimit_ = on; }
    void setStripLimit(bool on) { stripLimit_ = on; }
    // while audio capture runs a second, lower ceiling also applies. The lower of the two always wins
    void setAudioActive(bool active) {
        reshow_ = reshow_ || active != audioActive_;
        audioActive_ = active;
    }
    // the SENSE_5V reading in millivolts on the pin. While audio runs a low rail lowers the ceiling a step
    // at a time, with hysteresis
    void setRailPinMv(uint16_t mv) {
        uint8_t step = railStepFor(railStep_, mv);
        reshow_ = reshow_ || step != railStep_;
        railStep_ = step;
    }
    uint8_t railStep() const { return railStep_; }
    uint16_t effectiveCeiling() const {
        uint16_t audio = kRailStepCeilingMa[railStep_];
        return audioActive_ && audio < supplyCeilingMa_ ? audio : supplyCeilingMa_;
    }
    // true when nothing is lit at the strip, judged on the frame that was actually sent (after the ceiling)
    bool allDark() const {
        for (size_t i = 0; i < count_; i++) {
            if ((final_[i].r | final_[i].g | final_[i].b) != 0) {
                return false;
            }
        }
        return true;
    }
    const Rgb *requested() const { return requested_; }
    size_t count() const { return count_; }
    uint16_t scale() const { return scale_; }

   private:
    uint32_t holdUntilMs_ = 0;
    bool holding_ = false;
    // a low/high phase tracker for one quantity (a light's luminance, the strip's total, the lit count)
    struct Swing {
        bool high = false;
        int32_t low = 0, hi = 0;
        uint32_t rises[kMaxRises] = {};
        uint8_t n = 0;
        int cap = kMaxRises;  // rises allowed in a second: 3 for a light, 2 for the strip as a whole
        int recent(uint32_t now) const {
            int r = 0;
            for (uint8_t k = 0; k < n; k++) {
                r += (uint32_t)(now - rises[k]) < kWindowMs;
            }
            return r;
        }
        // a fall of at least thr from the high state, with no rise left to spare, is refused
        bool refuses(int32_t v, int32_t thr, uint32_t now) const { return high && hi - v >= thr && recent(now) >= cap; }
        // a rise of thr or more, with no rise left to spare, is cut back to just under thr above the low state. This
        // limits rises directly, so it holds even after a fall the guard did not choose (the ceiling's)
        int32_t capRise(int32_t v, int32_t thr, uint32_t now) const {
            if (!high && v - low >= thr && recent(now) >= cap) {
                return low + thr - 1;
            }
            return v;
        }
        void update(int32_t v, int32_t thr, uint32_t now) {
            if (high) {
                hi = v > hi ? v : hi;
                if (hi - v >= thr) {
                    high = false;
                    low = v;
                }
            } else {
                low = v < low ? v : low;
                if (v - low >= thr) {
                    if (n == kMaxRises) {
                        for (int k = 1; k < kMaxRises; k++) {
                            rises[k - 1] = rises[k];
                        }
                        n--;
                    }
                    rises[n++] = now;
                    high = true;
                    hi = v;
                }
            }
        }
    };

    Clock &clock_;
    LedSink &down_;
    uint16_t supplyCeilingMa_;
    bool audioActive_ = false;
    uint8_t railStep_ = 0;
    bool held_ = false;
    bool reshow_ = false;
    bool swingLimit_ = true;
    bool stripLimit_ = true;
    Rgb requested_[kGuardLeds] = {};
    Rgb final_[kGuardLeds] = {};
    Rgb prevHeld_[kGuardLeds] = {};   // the last frame the rules produced, before the ceiling
    Rgb hiPix_[kGuardLeds] = {};      // each light's brighter state
    Rgb lastLit_[kGuardLeds] = {};
    bool lit_[kGuardLeds] = {};
    uint32_t litRises_[kGuardLeds][kMaxRises] = {};
    uint8_t litRiseCount_[kGuardLeds] = {};
    Swing lightSwing_[kGuardLeds];
    Swing stripSwing_;
    uint32_t falls_[kMaxFallsPerSecond] = {};  // times of the strip's recent falls, oldest first
    uint8_t fallCount_ = 0;
    size_t count_ = 0;
    uint16_t scale_ = 256;     // the ceiling's scale, 0 to 256
    uint32_t scaleChangedMs_ = 0;
    bool scaleSet_ = false;

    size_t keys_ = 0, frets_ = 0, aux_ = 0, auxInUse_ = 0;
    // working frames, owned by the guard so they are not on the loop task's stack (3 x 1.4 KB at 480 lights)
    Rgb all_[kGuardLeds];
    Rgb out_[kGuardLeds];
    Rgb scratch_[kGuardLeds];
    uint16_t scaleFor(const Rgb *px, size_t n, uint16_t ceilingMa);
    void showCombined(const Rgb *pixels, size_t count);
    // the rule state that a trial of the rules may change, kept so the rules can be run again at another scale
    bool snapLit_[kGuardLeds] = {};
    uint32_t snapLitRises_[kGuardLeds][kMaxRises] = {};
    uint8_t snapLitRiseCount_[kGuardLeds] = {};
    Rgb snapLastLit_[kGuardLeds] = {};
    uint32_t snapFalls_[kMaxFallsPerSecond] = {};
    uint8_t snapFallCount_ = 0;
    int32_t stripTotal_ = 0;
    void saveRuleState();
    void restoreRuleState();
    // a light held by a rule keeps what it was shown, lowered to holdScale (256 is as it was shown). Lowering is how a
    // fall of the ceiling releases held brightness: a held light stays lit, only dimmer
    void applyRules(const Rgb *pixels, size_t count, uint16_t scale, uint16_t holdScale, uint32_t now);
    // lights that wait for a fall: the fall budget goes to the one that has waited longest
    bool wantOn_[kGuardLeds] = {};
    bool everLit_[kGuardLeds] = {};
    uint32_t darkSince_[kGuardLeds] = {};
    uint32_t relights_[kMaxRelightsPerSecond] = {};
    uint8_t relightCount_ = 0;
    uint32_t snapRelights_[kMaxRelightsPerSecond] = {};
    uint8_t snapRelightCount_ = 0;
    int relightsInWindow(uint32_t now) const;
    void recordRelight(uint32_t now);
    bool immediateDark_ = false;
    bool darkNowGiven_ = false;
    uint32_t lastDarkNowMs_ = 0;
    bool immediateThisPass_ = false;
    bool wantDark_[kGuardLeds] = {};
    bool waiting_[kGuardLeds] = {};
    bool grant_[kGuardLeds] = {};
    uint32_t waitSince_[kGuardLeds] = {};
    int fallsInWindow(uint32_t now) const;
    void recordFall(uint32_t now);
};

}  // namespace melophos
