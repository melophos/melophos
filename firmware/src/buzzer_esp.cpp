#include "buzzer_esp.h"

#include <Arduino.h>
#include <esp_timer.h>

#include "melophos_config.h"

namespace melophos {

#if PIN_BUZZER >= 0 && !MELOPHOS_JTAG

// the Arduino core in use (2.0.x) drives the LEDC peripheral by channel
static const uint8_t kChannel = 7;

static void endByTimer(void *arg) {
    BuzzerPin *pin = static_cast<BuzzerPin *>(arg);
    BuzzerOutput *target = pin->endTarget();  // the serialised output: it takes the lock
    if (target != nullptr) {
        target->silence();  // runs in the esp_timer task, so a blocked loop cannot hold a sound open
    } else {
        pin->silence();  // no target set yet: the sound still ends, on the raw pin
    }
}

void BuzzerPin::tone(uint16_t hz, uint8_t dutyPct, uint16_t durationMs) {
    if (endTarget_ == nullptr) {
        return;  // refused until the serialised output that the timer ends sounds through is set
    }
    if (timer_ == nullptr) {
        esp_timer_create_args_t args = {};
        args.callback = endByTimer;
        args.arg = this;
        args.name = "buzzer";
        esp_timer_handle_t h = nullptr;
        if (esp_timer_create(&args, &h) != ESP_OK) {
            return;  // no timer, no sound: the end could not be guaranteed
        }
        timer_ = h;
    }
    esp_timer_stop(static_cast<esp_timer_handle_t>(timer_));
    ledcSetup(kChannel, hz, 8);
    if (!attached_) {
        ledcAttachPin(PIN_BUZZER, kChannel);
        attached_ = true;
    }
    ledcWrite(kChannel, (uint32_t)dutyPct * 255u / 100u);
    esp_timer_start_once(static_cast<esp_timer_handle_t>(timer_), (uint64_t)durationMs * 1000u);
}

void BuzzerPin::silence() {
    if (timer_ != nullptr) {
        esp_timer_stop(static_cast<esp_timer_handle_t>(timer_));
    }
    if (attached_) {
        ledcWrite(kChannel, 0);
        ledcDetachPin(PIN_BUZZER);
        attached_ = false;
    }
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);  // off: the transistor's base is held low
}

#else

void BuzzerPin::tone(uint16_t, uint8_t, uint16_t) {}
void BuzzerPin::silence() {}

#endif

}  // namespace melophos
