#pragma once

#include <stdint.h>

namespace melophos {

// whether the DC inlet is powering the board. The console's USB-C cannot power the +5V rail: it reaches only
// +5V_SYS and the or-ing diode passes just its reverse leakage back onto +5V. From the schematic:
//   DC inlet only      the rail reads 4.69 to 5.25 V with the LEDs dark (4.33 V at full load), which is
//                      2.34 to 2.63 V on SENSE_5V (GPIO 1, half the rail)
//   USB-C alone        at most 1.24 V on the rail, 0.62 V on the pin, at 25 C. The diode's leakage warm is
//                      not stated yet
//
// The rail rule:
//   present   latched from a reading of 4.4 V or more on the rail (2.2 V on the pin) taken at start-up with the
//             LEDs dark, before the first frame
//   dropped   only when the rail reads under 3.0 V (1.5 V on the pin), so a loaded rail at 4.33 V (2.165 V on
//             the pin) never reads as "inlet absent"
//   regained  by a reading of 2.2 V or more on the pin while the LEDs are dark
//
// SENSE_VIN (GPIO 13) is read as a LOGIC input, not through the ADC (it is on the second ADC unit, which
// cannot be used while Wi-Fi runs). The jack goes through a divider of 47 k over 68 k with a 10 k series
// resistor to the pin: the pin sees 0.5913 of the jack, 2.66 V at 4.50 V, 2.81 V at 4.75 V, 2.96 V at 5.00 V and
// 3.10 V at 5.25 V. Truth table:
//   low                           no inlet. A reversed plug also reads low and the board blocks it
//   high and the rail latched     inlet present
//   high and the rail under 3.0 V over-voltage lockout (reported on serial and on the status LED)
//   high, the rail in between     nothing changes (a sag)
//   between 1.36 V and 4.48 V at the jack the logic level is undefined and SENSE_5V decides there: a low
//   reading with a rail of 4.4 V or more is the rail saying the inlet is present
// Where it is fitted SENSE_VIN is what tells a good inlet from USB power and SENSE_5V is the rail reading
// for the audio backstop.
namespace inlet {
const uint16_t kRailPresentPinMv = 2200;  // 4.4 V on the rail
const uint16_t kRailAbsentPinMv = 1500;   // 3.0 V on the rail
}  // namespace inlet

enum class InletState : uint8_t { Absent, Present, OverVoltage };

class InletSense {
   public:
    // vin: -1 where SENSE_VIN is not fitted, else 0 for low and 1 for high
    // At start-up with the LEDs dark
    void begin(uint16_t railPinMv, int8_t vin);
    // every pass. ledsDark is true while no LED is lit
    void update(uint16_t railPinMv, int8_t vin, bool ledsDark);
    bool present() const { return state_ == InletState::Present; }
    InletState state() const { return state_; }
    bool usesVin() const { return usesVin_; }

   private:
    InletState state_ = InletState::Absent;
    bool usesVin_ = false;
};

// what the supply ceiling is told. A loose plug or noise on SENSE_VIN while the rail is fine, can make the raw reading
// flap and each drop forces every light dark. So the gate:
//   - turns to ABSENT at once when the raw reading drops and holds absent for at least kHoldAbsentMs (1 s) from the
//     drop, so a ceiling of 0 lasts at least a second whatever the raw reading does
//   - counts the inlet as back only after the raw reading has been PRESENT without a break for kConfirmPresentMs
//     (500 ms) and the hold is over
// The first reading after power-up is believed at once (start-up already latched it with the LEDs dark).
// With the guard's own off-to-on limit this keeps a flapping plug from blinking the lights
class InletGate {
   public:
    static const uint32_t kHoldAbsentMs = 1000;
    static const uint32_t kConfirmPresentMs = 500;
    bool step(bool rawPresent, uint32_t nowMs) {
        if (!started_) {
            started_ = true;
            present_ = rawPresent;
            rawSince_ = nowMs;
            raw_ = rawPresent;
            return present_;
        }
        if (rawPresent != raw_) {
            raw_ = rawPresent;
            rawSince_ = nowMs;
        }
        if (present_ && !rawPresent) {
            present_ = false;
            droppedMs_ = nowMs;
        } else if (!present_ && rawPresent && (uint32_t)(nowMs - rawSince_) >= kConfirmPresentMs &&
                   (uint32_t)(nowMs - droppedMs_) >= kHoldAbsentMs) {
            present_ = true;
        }
        return present_;
    }
    bool present() const { return present_; }

   private:
    bool started_ = false;
    bool present_ = false;
    bool raw_ = false;
    uint32_t rawSince_ = 0;
    uint32_t droppedMs_ = 0;
};

}  // namespace melophos
