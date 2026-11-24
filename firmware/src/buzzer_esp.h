#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "buzzer.h"

namespace melophos {

// the buzzer pin behind the BuzzerOutput seam. A sound is ended by a one-shot esp_timer set when it starts, so the
// longest sound does not depend on the loop running. Compile-only: it awaits a board. With MELOPHOS_JTAG (a board that has
// JTAG on GPIO 39 to 42, which the rev A hub does not) the pin is never touched, as GPIO 40 is JTAG's data out there
class BuzzerLock : public Lock {
   public:
    BuzzerLock() : m_(xSemaphoreCreateMutex()) {}
    void lock() override { xSemaphoreTake(m_, portMAX_DELAY); }
    void unlock() override { xSemaphoreGive(m_); }

   private:
    SemaphoreHandle_t m_;
};

// the raw pin. Reach it only through a SerialisedOutput: the loop task starts and ends sounds and the esp_timer task
// ends them too, so every call must hold the lock. setEndTarget names the serialised output the timer calls
class BuzzerPin : public BuzzerOutput {
   public:
    void setEndTarget(BuzzerOutput *target) { endTarget_ = target; }
    BuzzerOutput *endTarget() const { return endTarget_; }
    void tone(uint16_t hz, uint8_t dutyPct, uint16_t durationMs) override;
    void silence() override;

   private:
    bool attached_ = false;
    void *timer_ = nullptr;
    BuzzerOutput *endTarget_ = nullptr;
};

}  // namespace melophos
