#include "encoder_esp.h"

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include "encoder.h"
#include "melophos_config.h"

namespace melophos {

namespace {

class MutexLock : public Lock {
   public:
    MutexLock() : m_(xSemaphoreCreateMutex()) {}
    void lock() override { xSemaphoreTake(m_, portMAX_DELAY); }
    void unlock() override { xSemaphoreGive(m_); }

   private:
    SemaphoreHandle_t m_;
};

MutexLock eventLock;
EncoderEvents events(&eventLock);  // with no reader the oldest events are dropped, never the newest

void encoderTask(void *) {
    QuadratureDecoder decoder;
    DebouncedSwitch sw(ENC_SW_ACTIVE_LOW != 0);
    for (;;) {
        int d = decoder.feed(digitalRead(PIN_ENC_A) == HIGH, digitalRead(PIN_ENC_B) == HIGH);
        if (d != 0) {
            events.push(EncoderEvent{EncoderEvent::Turn, (int8_t)d});
        }
        SwitchEvent s = sw.feed(digitalRead(PIN_ENC_SW) == HIGH, millis());
        if (s == SwitchEvent::Press) {
            events.push(EncoderEvent{EncoderEvent::Press, 0});
        } else if (s == SwitchEvent::LongPress) {
            events.push(EncoderEvent{EncoderEvent::LongPress, 0});
        }
        vTaskDelay(1);  // one tick: the Arduino core runs the tick at 1 kHz
    }
}

}  // namespace

void Encoder::begin() {
#if PIN_ENC_A >= 0 && PIN_ENC_B >= 0 && PIN_ENC_SW >= 0
    xTaskCreate(encoderTask, "encoder", 2048, nullptr, 1, nullptr);
#endif
}

bool Encoder::next(EncoderEvent &out) {
    return events.pop(out);
}

void Encoder::startFromNow() {
    events.clear();
}

uint32_t Encoder::dropped() {
    return events.dropped();
}

}  // namespace melophos
