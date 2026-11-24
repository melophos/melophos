#include "inlet.h"

namespace melophos {

void InletSense::begin(uint16_t rail, int8_t vin) {
    usesVin_ = vin >= 0;
    state_ = InletState::Absent;
    if (rail >= inlet::kRailPresentPinMv) {
        state_ = InletState::Present;  // the rail decides, including in the band where the logic level is undefined
    } else if (usesVin_ && vin == 1 && rail < inlet::kRailAbsentPinMv) {
        state_ = InletState::OverVoltage;
    }
}

void InletSense::update(uint16_t rail, int8_t vin, bool ledsDark) {
    usesVin_ = vin >= 0;
    if (state_ == InletState::Present) {
        if (rail < inlet::kRailAbsentPinMv) {
            // only a collapsed rail drops it, never a loaded one. High at the jack with no rail is a lockout
            state_ = (usesVin_ && vin == 1) ? InletState::OverVoltage : InletState::Absent;
        } else if (usesVin_ && vin == 0 && rail < inlet::kRailPresentPinMv) {
            // a good inlet reads high: low with a rail that is not at least 4.4 V is no inlet
            state_ = InletState::Absent;
        }
        return;
    }
    if (ledsDark && rail >= inlet::kRailPresentPinMv) {
        state_ = InletState::Present;
    } else if (usesVin_ && vin == 1 && rail < inlet::kRailAbsentPinMv) {
        state_ = InletState::OverVoltage;
    } else if (state_ == InletState::OverVoltage && !(usesVin_ && vin == 1 && rail < inlet::kRailAbsentPinMv)) {
        state_ = InletState::Absent;  // the lockout cleared
    }
}

}  // namespace melophos
