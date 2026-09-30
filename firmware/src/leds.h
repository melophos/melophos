#pragma once

#include <stdint.h>

#include "keymap.h"

namespace melophos {

enum class LightRole : uint8_t { Played, Guide, Upcoming, Wrong };

// Owns the LED bars and turns note state into colour. Rendering happens in one
// place so every practice mode shares the same colour language.
class Leds {
   public:
    void begin(const KeyboardProfile &profile);
    void setNote(uint8_t note, LightRole role, bool on);
    void clear();
    void show();

   private:
    KeyboardProfile profile_{};
};

}  // namespace melophos
