#include "outputguard.h"

#include <string.h>

namespace melophos {

namespace {

bool isLit(const Rgb &p) {
    return (p.r | p.g | p.b) != 0;
}

Rgb scaled(const Rgb &p, uint16_t scale) {
    if (scale >= 256) {
        return p;
    }
    Rgb o{(uint8_t)((uint32_t)p.r * scale >> 8), (uint8_t)((uint32_t)p.g * scale >> 8), (uint8_t)((uint32_t)p.b * scale >> 8)};
    if (isLit(p) && !isLit(o)) {
        // scaled to nothing: a lit light is never made dark by the ceiling
        if (p.r >= p.g && p.r >= p.b) {
            o.r = 1;
        } else if (p.g >= p.b) {
            o.g = 1;
        } else {
            o.b = 1;
        }
    }
    return o;
}

// the brightest scale of p whose relative luminance is no more than cap (scaling rounds down per channel, so a
// proportional guess can land over: search it)
Rgb capLuminance(const Rgb &p, int32_t cap) {
    uint16_t lo = 0, hi = 256;
    while (hi - lo > 1) {
        uint16_t mid = (uint16_t)((lo + hi) / 2);
        if (relativeLuminance(scaled(p, mid)) <= cap) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return scaled(p, lo);
}

}  // namespace

int OutputGuard::fallsInWindow(uint32_t now) const {
    int n = 0;
    for (uint8_t k = 0; k < fallCount_; k++) {
        n += (uint32_t)(now - falls_[k]) < kWindowMs;
    }
    return n;
}

int OutputGuard::relightsInWindow(uint32_t now) const {
    int n = 0;
    for (uint8_t k = 0; k < relightCount_; k++) {
        n += (uint32_t)(now - relights_[k]) < kWindowMs;
    }
    return n;
}

void OutputGuard::recordRelight(uint32_t now) {
    uint8_t keep = 0;
    for (uint8_t k = 0; k < relightCount_; k++) {
        if ((uint32_t)(now - relights_[k]) < kWindowMs) {
            relights_[keep++] = relights_[k];
        }
    }
    relightCount_ = keep;
    if (relightCount_ < kMaxRelightsPerSecond) {
        relights_[relightCount_++] = now;
    }
}

void OutputGuard::recordFall(uint32_t now) {
    // drop the ones that left the window, then append
    uint8_t keep = 0;
    for (uint8_t k = 0; k < fallCount_; k++) {
        if ((uint32_t)(now - falls_[k]) < kWindowMs) {
            falls_[keep++] = falls_[k];
        }
    }
    fallCount_ = keep;
    if (fallCount_ < kMaxFallsPerSecond) {
        falls_[fallCount_++] = now;
    }
}

void OutputGuard::show(const Rgb *pixels, size_t count) {
    if (layoutTotal() == 0) {
        showCombined(pixels, count);
        return;
    }
    showOutputs(pixels, count, nullptr, 0, nullptr, 0);
}

// the scale (0 to 256) that brings a frame under a ceiling, without touching the frame
uint16_t OutputGuard::scaleFor(const Rgb *px, size_t n, uint16_t ceilingMa) {
    memcpy(scratch_, px, n * sizeof(Rgb));
    return applyCeiling(scratch_, n, ceilingMa);
}

void OutputGuard::showOutputs(const Rgb *keys, size_t nKeys, const Rgb *frets, size_t nFrets, const Rgb *aux, size_t nAux) {
    size_t total = layoutTotal();
    if (total == 0) {
        showCombined(keys, nKeys);
        return;
    }
    Rgb *all = all_;
    memset(all, 0, sizeof(Rgb) * kGuardLeds);
    for (size_t i = 0; i < nKeys && i < keys_ && keys != nullptr; i++) {
        all[i] = keys[i];
    }
    for (size_t i = 0; i < nFrets && i < frets_ && frets != nullptr; i++) {
        all[keys_ + i] = frets[i];
    }
    for (size_t i = 0; i < nAux && i < auxInUse_ && aux != nullptr; i++) {  // beyond the length in use stays dark
        all[keys_ + frets_ + i] = aux[i];
    }
    showCombined(all, total);
}

void OutputGuard::saveRuleState() {
    memcpy(snapLit_, lit_, sizeof lit_);
    memcpy(snapLitRises_, litRises_, sizeof litRises_);
    memcpy(snapLitRiseCount_, litRiseCount_, sizeof litRiseCount_);
    memcpy(snapLastLit_, lastLit_, sizeof lastLit_);
    memcpy(snapFalls_, falls_, sizeof falls_);
    snapFallCount_ = fallCount_;
    memcpy(snapRelights_, relights_, sizeof relights_);
    snapRelightCount_ = relightCount_;
}

void OutputGuard::restoreRuleState() {
    memcpy(lit_, snapLit_, sizeof lit_);
    memcpy(litRises_, snapLitRises_, sizeof litRises_);
    memcpy(litRiseCount_, snapLitRiseCount_, sizeof litRiseCount_);
    memcpy(lastLit_, snapLastLit_, sizeof lastLit_);
    memcpy(falls_, snapFalls_, sizeof falls_);
    fallCount_ = snapFallCount_;
    memcpy(relights_, snapRelights_, sizeof relights_);
    relightCount_ = snapRelightCount_;
}

// the per-light rules and the strip's fall budget, on the frame as it would be shown at this scale. Leaves the
// result in out_ and the total luminance of it in stripTotal_. It changes only the state that saveRuleState keeps,
// so it can be run again at another scale
void OutputGuard::applyRules(const Rgb *pixels, size_t count, uint16_t scale, uint16_t holdScale, uint32_t now) {
    held_ = false;
    Rgb *out = out_;
    auto held = [&](const Rgb &p) { return scaled(p, holdScale); };
    for (size_t i = 0; i < count; i++) {
        Rgb eff = scaled(pixels[i], scale);
        int32_t y = relativeLuminance(eff);
        if (swingLimit_) {
            int32_t cap = lightSwing_[i].capRise(y, kLargeSwing, now);
            if (cap < y) {
                eff = capLuminance(eff, cap);  // a fourth large rise in a second: cut back
                y = relativeLuminance(eff);
            }
        }
        if (swingLimit_ && lightSwing_[i].refuses(y, kLargeSwing, now)) {
            eff = held(prevHeld_[i]);  // stay as it was shown: steady and never brighter than what already fitted the ceiling
            held_ = true;
        }
        wantOn_[i] = false;
        if (isLit(eff)) {
            if (!lit_[i]) {
                // off to on. A light with 3 of these in the window stays dark, whatever darkened it. Otherwise the
                // strip's own limit below decides and only then is the change counted
                int recentOns = 0;
                for (uint8_t k = 0; k < litRiseCount_[i]; k++) {
                    recentOns += (uint32_t)(now - litRises_[i][k]) < kWindowMs;
                }
                if (recentOns >= kMaxRises) {
                    out[i] = Rgb{0, 0, 0};
                    held_ = true;
                } else {
                    wantOn_[i] = true;
                    lastLit_[i] = eff;
                    out[i] = eff;
                }
            } else {
                lastLit_[i] = eff;
                out[i] = eff;
            }
        } else if (!lit_[i]) {
            out[i] = Rgb{0, 0, 0};
        } else {
            int recent = 0;
            for (uint8_t k = 0; k < litRiseCount_[i]; k++) {
                recent += (uint32_t)(now - litRises_[i][k]) < kWindowMs;
            }
            if (recent >= kMaxRises) {
                out[i] = held(lastLit_[i]);  // no edge to spare: stay lit instead of going dark
                held_ = true;
            } else {
                out[i] = Rgb{0, 0, 0};
                lit_[i] = false;
            }
        }
    }
    // lights coming on. A light that comes on within a second of going dark is a RE-LIGHT: at most 30 of them in any
    // second across the strip, to the light that has been dark longest. A light dark for more than a second is free.
    // Each change is counted in the light's own 3 off-to-on changes as well
    {
        int budget = stripLimit_ ? kMaxRelightsPerSecond - relightsInWindow(now) : 1000000;
        if (budget < 0) {
            budget = 0;
        }
        size_t quick = 0;
        for (size_t i = 0; i < count; i++) {
            grant_[i] = false;
            bool isQuick = wantOn_[i] && everLit_[i] && (uint32_t)(now - darkSince_[i]) < kWindowMs;
            if (wantOn_[i] && !isQuick) {
                grant_[i] = true;  // dark for more than a second or never lit: free
            }
            quick += isQuick;
        }
        if ((size_t)budget >= quick) {
            for (size_t i = 0; i < count; i++) {
                grant_[i] = grant_[i] || wantOn_[i];
            }
        } else {
            for (int k = 0; k < budget; k++) {
                size_t best = count;
                uint32_t bestAge = 0;
                for (size_t i = 0; i < count; i++) {
                    if (wantOn_[i] && !grant_[i]) {
                        uint32_t age = (uint32_t)(now - darkSince_[i]);
                        if (best == count || age > bestAge) {
                            best = i;
                            bestAge = age;
                        }
                    }
                }
                if (best == count) {
                    break;
                }
                grant_[best] = true;
            }
        }
        for (size_t i = 0; i < count; i++) {
            if (!wantOn_[i]) {
                continue;
            }
            if (!grant_[i]) {
                out[i] = Rgb{0, 0, 0};  // a re-light that must wait: it stays dark and is free after a second
                held_ = true;
                continue;
            }
            if (stripLimit_ && everLit_[i] && (uint32_t)(now - darkSince_[i]) < kWindowMs) {
                recordRelight(now);
            }
            if (litRiseCount_[i] == kMaxRises) {
                for (int k = 1; k < kMaxRises; k++) {
                    litRises_[i][k - 1] = litRises_[i][k];
                }
                litRiseCount_[i]--;
            }
            litRises_[i][litRiseCount_[i]++] = now;
            lit_[i] = true;
        }
    }
    stripTotal_ = 0;
    if (!stripLimit_) {
        for (size_t i = 0; i < count; i++) {
            stripTotal_ += relativeLuminance(out[i]);
        }
        return;
    }
    // the strip as a whole. Falls are counted across every light and so is the total luminance
    // lights going out: only as many as the strip's budget for the second has left and the budget goes to the light
    // that has waited longest, so no light can be starved by busier ones (see kFallWaitBoundMs)
    int budget = kMaxFallsPerSecond - fallsInWindow(now);
    size_t candidates = 0;
    for (size_t i = 0; i < count; i++) {
        grant_[i] = false;
        wantDark_[i] = isLit(prevHeld_[i]) && !isLit(out[i]);
        candidates += wantDark_[i];
    }
    if (budget < 0) {
        budget = 0;
    }
    if (immediateThisPass_ || (size_t)budget >= candidates) {  // darkNow: the queue is skipped, the falls are still counted
        for (size_t i = 0; i < count; i++) {
            grant_[i] = wantDark_[i];
        }
    } else {
        for (int k = 0; k < budget; k++) {
            size_t best = count;
            uint32_t bestAge = 0;
            for (size_t i = 0; i < count; i++) {
                if (wantDark_[i] && !grant_[i]) {
                    uint32_t age = waiting_[i] ? (uint32_t)(now - waitSince_[i]) : 0;
                    if (best == count || age > bestAge) {
                        best = i;
                        bestAge = age;
                    }
                }
            }
            if (best == count) {
                break;
            }
            grant_[best] = true;
        }
    }
    for (size_t i = 0; i < count; i++) {
        if (!wantDark_[i]) {
            continue;
        }
        if (grant_[i]) {
            recordFall(now);
        } else {
            out[i] = held(prevHeld_[i]);  // held lit: it cannot rise again, so it cannot flicker
            held_ = true;
        }
    }
    // the total luminance: a large fall with no rise to spare is refused, whatever each light's own swing
    int32_t total = 0;
    for (size_t i = 0; i < count; i++) {
        total += relativeLuminance(out[i]);
    }
    if (stripSwing_.refuses(total, kStripSwing, now)) {
        for (size_t i = 0; i < count; i++) {
            if (relativeLuminance(out[i]) < relativeLuminance(prevHeld_[i])) {
                out[i] = held(prevHeld_[i]);
                held_ = true;
            }
        }
        total = 0;
        for (size_t i = 0; i < count; i++) {
            total += relativeLuminance(out[i]);
        }
    }
    if (swingLimit_) {
        int32_t cap = stripSwing_.capRise(total, kStripSwing, now);
        if (cap < total) {
            // a third large rise of the whole strip in a second: cut every light back by one scale, the brightest that
            // leaves the total no more than cap
            uint16_t lo = 0, hi = 256;
            while (hi - lo > 1) {
                uint16_t mid = (uint16_t)((lo + hi) / 2);
                int32_t t = 0;
                for (size_t i = 0; i < count; i++) {
                    t += relativeLuminance(scaled(out[i], mid));
                }
                if (t <= cap) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            for (size_t i = 0; i < count; i++) {
                out[i] = scaled(out[i], lo);
            }
            total = 0;
            for (size_t i = 0; i < count; i++) {
                total += relativeLuminance(out[i]);
            }
            held_ = true;
        }
    }
    stripTotal_ = total;
    // a light that was held lit is lit again for the per-light rules
    for (size_t i = 0; i < count; i++) {
        if (isLit(out[i]) && !lit_[i]) {
            lit_[i] = true;
        }
    }
}

// the draw of a frame in units of one channel at full (the sum of the channel values)
static uint64_t unitsOf(const Rgb *px, size_t n) {
    uint64_t sum = 0;
    for (size_t i = 0; i < n; i++) {
        sum += (uint32_t)px[i].r + px[i].g + px[i].b;
    }
    return sum;
}

void OutputGuard::showCombined(const Rgb *pixels, size_t count) {
    if (count > kGuardLeds) {
        count = kGuardLeds;
    }
    uint32_t now = clock_.nowMs();
    count_ = count;
    reshow_ = false;
    // darkNow is honoured at most once a second, here, whatever calls it: a call inside the second is dropped and its
    // lights fall through the normal fall queue. Differences of the unsigned time are safe across the timer wrap
    immediateThisPass_ = false;
    if (immediateDark_) {
        if (!darkNowGiven_ || (uint32_t)(now - lastDarkNowMs_) >= kDarkNowMinGapMs) {
            immediateThisPass_ = true;
            darkNowGiven_ = true;
            lastDarkNowMs_ = now;
        }
        immediateDark_ = false;
    }
    for (size_t i = 0; i < count; i++) {
        requested_[i] = pixels[i];
    }
    uint16_t ceiling = effectiveCeiling();

    // 1. the ceiling's scale, with the floor in it. It drops at once when the requested frame would draw too much
    // and rises again only once a second, so it cannot make a light swing
    uint16_t ideal = scaleFor(pixels, count, ceiling);
    if (!scaleSet_) {
        scale_ = ideal;
        scaleSet_ = true;
        scaleChangedMs_ = now;
    } else if (ideal < scale_) {
        scale_ = ideal;
        scaleChangedMs_ = now;
    } else if (ideal > scale_) {
        if ((uint32_t)(now - scaleChangedMs_) >= kScaleRaiseMs) {
            scale_ = ideal;
            scaleChangedMs_ = now;
        } else {
            reshow_ = true;  // waiting to come back up: another pass will do it even if nothing changes
        }
    }

    // 2. the rules on the frame as it would be shown. A hold can add current that the scale did not allow for, so
    // the scale is lowered and the rules run again from the same state, until the frame that the rules produce
    // fits the ceiling. What the rules judged is then what is shown
    uint64_t allowed = ceiling > count ? ceiling - count : 0;
    auto fits = [&](const Rgb *px) { return ceiling > count && unitsOf(px, count) * 20u <= allowed * 255u; };
    saveRuleState();
    applyRules(pixels, count, scale_, 256, now);
    if (!fits(out_) && ceiling > count) {
        // held lights carry brightness from a higher ceiling. First release it: lower the held lights (they stay lit,
        // only dimmer) as far as the ceiling needs, so the requested lights keep the scale they were given
        uint16_t hold = 0;
        restoreRuleState();
        applyRules(pixels, count, scale_, 0, now);
        if (fits(out_)) {
            uint16_t lo = 0, hi = 256;  // fits at lo, does not fit at hi
            while (hi - lo > 1) {
                uint16_t mid = (uint16_t)((lo + hi) / 2);
                restoreRuleState();
                applyRules(pixels, count, scale_, mid, now);
                if (fits(out_)) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            hold = lo;
        } else {
            // even with the holds at the floor it does not fit: lower the scale too, holds at the floor
            uint16_t hi = scale_;
            uint16_t lo = 0;
            restoreRuleState();
            applyRules(pixels, count, 0, 0, now);
            if (fits(out_)) {
                while (hi - lo > 1) {
                    uint16_t mid = (uint16_t)((lo + hi) / 2);
                    restoreRuleState();
                    applyRules(pixels, count, mid, 0, now);
                    if (fits(out_)) {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
            }
            restoreRuleState();
            applyRules(pixels, count, lo, 0, now);
            if (lo < scale_) {
                scale_ = lo == 0 ? 1 : lo;
                scaleChangedMs_ = now;
            }
            hold = 0xFFFF;
        }
        if (hold != 0xFFFF) {
            restoreRuleState();
            applyRules(pixels, count, scale_, hold, now);
        }
    }
    Rgb *out = out_;

    // 3. the ceiling again, last. After the search above it only acts when no scale made the frame fit (a ceiling
    // under what the floor needs, which the firmware never sets). It is applied BEFORE the trackers learn
    memcpy(final_, out, count * sizeof(Rgb));
    uint16_t extra = applyCeiling(final_, count, ceiling);
    if (extra < 256) {
        for (size_t i = 0; i < count; i++) {
            if (isLit(out[i]) && !isLit(final_[i])) {
                recordFall(now);  // a light the ceiling had to put out counts against the strip's falls
            }
        }
    }

    // 4. every tracker learns the frame that is actually sent, the strip's total as well as each light
    int32_t sentTotal = 0;
    for (size_t i = 0; i < count; i++) {
        sentTotal += relativeLuminance(final_[i]);
    }
    stripSwing_.update(sentTotal, kStripSwing, now);
    for (size_t i = 0; i < count; i++) {
        int32_t y = relativeLuminance(final_[i]);
        bool wasHigh = lightSwing_[i].high;
        lightSwing_[i].update(y, kLargeSwing, now);
        if (lightSwing_[i].high && (!wasHigh || y >= lightSwing_[i].hi)) {
            hiPix_[i] = final_[i];
        }
        if (!isLit(final_[i])) {
            if (isLit(prevHeld_[i])) {
                darkSince_[i] = now;  // went dark now
            }
            lit_[i] = false;
        } else {
            everLit_[i] = true;
            lit_[i] = true;
            lastLit_[i] = final_[i];
        }
        prevHeld_[i] = final_[i];
        // a light that was asked dark and is still lit has been waiting since it was first asked
        if (wantDark_[i] && isLit(final_[i])) {
            if (!waiting_[i]) {
                waiting_[i] = true;
                waitSince_[i] = now;
            }
        } else {
            waiting_[i] = false;
        }
    }
    down_.show(final_, count);
}

}  // namespace melophos
