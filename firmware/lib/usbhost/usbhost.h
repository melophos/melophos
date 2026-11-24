#pragma once

#include <stdint.h>

#include "hal.h"

namespace melophos {

// the two things the state machine asks of the USB host stack and the power
// switch. The real ones sit on the ESP32-S3 USB host driver and the VBUS
// load switch. Fakes stand in on the host.
class UsbPower {
   public:
    virtual ~UsbPower() {}
    virtual void setVbus(bool on) = 0;
};

class UsbHostPort {
   public:
    virtual ~UsbHostPort() {}
    virtual void beginEnumeration() = 0;
    // drop the device, free its transfers and endpoints
    virtual void release() = 0;
};

enum class UsbState : uint8_t {
    Off,          // VBUS off, nothing asked of the port
    Waiting,      // VBUS on, no device yet
    Enumerating,  // a device is there, reading its descriptors
    Ready,        // a MIDI keyboard is streaming
    PowerCycle,   // VBUS off on purpose so a wedged device resets
    Rejected,     // a device that is not class-compliant MIDI, until it is unplugged
    Overcurrent,  // VBUS cut after an overcurrent flag, cooling down
    Latched       // too many faults in a row: off until clearFault()
};

// recovery without a reset: any detach, enumeration failure or timeout ends in
// a VBUS cycle and a fresh wait for a device. Bounded everywhere.
//   enumeration time-out   3 s
//   VBUS off time          500 ms, doubling after a failed enumeration up to 8 s
//   failed enumerations    5 in a row, then Rejected until unplugged
//   overcurrent            VBUS off, 10 s cool-down, latched after 3 in a row
class UsbHostFsm {
   public:
    static const uint32_t kEnumerateTimeoutMs = 3000;
    static const uint32_t kPowerCycleMs = 500;
    static const uint32_t kPowerCycleMaxMs = 8000;
    static const uint8_t kMaxEnumFailures = 5;
    static const uint32_t kOvercurrentCoolMs = 10000;
    static const uint8_t kMaxOvercurrent = 3;

    UsbHostFsm(Clock &clock, UsbPower &power, UsbHostPort &port) : clock_(clock), power_(power), port_(port) {}

    void begin();
    void tick();
    void onDeviceAttached();
    void onDeviceDetached();
    // the descriptors were read: midi is true for a class-compliant MIDI streaming interface
    void onEnumerated(bool ok, bool midi);
    void onOvercurrent();
    void clearFault();
    // false while the DC inlet is absent: the keyboard port stays off and nothing is tried. True starts it again
    void setPowerAllowed(bool allowed);

    UsbState state() const { return state_; }
    bool powerAllowed() const { return allowed_; }
    bool streaming() const { return state_ == UsbState::Ready; }
    uint32_t cycles() const { return cycles_; }

   private:
    Clock &clock_;
    UsbPower &power_;
    UsbHostPort &port_;
    UsbState state_ = UsbState::Off;
    uint32_t since_ = 0;
    uint32_t cycleMs_ = kPowerCycleMs;
    uint8_t failures_ = 0;
    uint8_t overcurrent_ = 0;
    bool allowed_ = true;
    uint32_t cycles_ = 0;

    void cycle(bool failed);
};

}  // namespace melophos
