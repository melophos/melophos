#include "usbhost.h"

namespace melophos {

void UsbHostFsm::setPowerAllowed(bool allowed) {
    if (allowed == allowed_) {
        return;
    }
    allowed_ = allowed;
    if (!allowed) {
        port_.release();
        power_.setVbus(false);  // the port is off and stays off
        state_ = UsbState::Off;
    } else {
        begin();
    }
}

void UsbHostFsm::begin() {
    if (!allowed_) {
        return;
    }
    power_.setVbus(true);
    state_ = UsbState::Waiting;
    since_ = clock_.nowMs();
}

void UsbHostFsm::cycle(bool failed) {
    port_.release();
    power_.setVbus(false);
    if (failed) {
        failures_++;
        cycleMs_ = cycleMs_ * 2 > kPowerCycleMaxMs ? kPowerCycleMaxMs : cycleMs_ * 2;
    }
    state_ = UsbState::PowerCycle;
    since_ = clock_.nowMs();
    cycles_++;
}

void UsbHostFsm::onDeviceAttached() {
    if (!allowed_) {
        return;
    }
    if (state_ != UsbState::Waiting) {
        return;  // an attach in any other state is stale
    }
    state_ = UsbState::Enumerating;
    since_ = clock_.nowMs();
    port_.beginEnumeration();
}

void UsbHostFsm::onDeviceDetached() {
    switch (state_) {
        case UsbState::Enumerating:
        case UsbState::Ready:
        case UsbState::Rejected:
            failures_ = 0;
            cycleMs_ = kPowerCycleMs;
            cycle(false);  // an unplug is not a fault: the next keyboard starts clean
            break;
        default:
            break;
    }
}

void UsbHostFsm::onEnumerated(bool ok, bool midi) {
    if (state_ != UsbState::Enumerating) {
        return;
    }
    if (!ok) {
        if (failures_ + 1 >= kMaxEnumFailures) {
            port_.release();
            state_ = UsbState::Rejected;
            since_ = clock_.nowMs();
            return;
        }
        cycle(true);
        return;
    }
    if (!midi) {
        port_.release();
        state_ = UsbState::Rejected;
        since_ = clock_.nowMs();
        return;
    }
    failures_ = 0;
    cycleMs_ = kPowerCycleMs;
    overcurrent_ = 0;
    state_ = UsbState::Ready;
}

void UsbHostFsm::onOvercurrent() {
    if (state_ == UsbState::Off || state_ == UsbState::Latched) {
        return;
    }
    port_.release();
    power_.setVbus(false);  // first, before anything else can fail
    overcurrent_++;
    state_ = overcurrent_ >= kMaxOvercurrent ? UsbState::Latched : UsbState::Overcurrent;
    since_ = clock_.nowMs();
}

void UsbHostFsm::clearFault() {
    if (!allowed_) {
        return;
    }
    if (state_ == UsbState::Latched || state_ == UsbState::Rejected) {
        overcurrent_ = 0;
        failures_ = 0;
        cycleMs_ = kPowerCycleMs;
        begin();
    }
}

void UsbHostFsm::tick() {
    if (!allowed_) {
        return;
    }
    uint32_t elapsed = clock_.nowMs() - since_;
    switch (state_) {
        case UsbState::Enumerating:
            if (elapsed >= kEnumerateTimeoutMs) {
                if (failures_ + 1 >= kMaxEnumFailures) {
                    port_.release();
                    state_ = UsbState::Rejected;
                    since_ = clock_.nowMs();
                } else {
                    cycle(true);
                }
            }
            break;
        case UsbState::PowerCycle:
            if (elapsed >= cycleMs_) {
                power_.setVbus(true);
                state_ = UsbState::Waiting;
                since_ = clock_.nowMs();
            }
            break;
        case UsbState::Overcurrent:
            if (elapsed >= kOvercurrentCoolMs) {
                power_.setVbus(true);
                state_ = UsbState::Waiting;
                since_ = clock_.nowMs();
            }
            break;
        default:
            break;
    }
}

}  // namespace melophos
