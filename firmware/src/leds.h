#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"

namespace melophos {

// the hub's LED outputs behind the LedSink seam: keys, frets and the third (aux) output, in that order in one
// frame. Colour, brightness patterns, the flash limits and the current ceiling are all decided in lib/practice
// and are TOTALS over all outputs, so this class only copies a finished frame to FastLED. FastLED's own power
// limit is global across its controllers, so it is a second guard on the same total. The second and third
// output await a board.
class Leds : public LedSink {
   public:
    // every output goes dark first, at its MAXIMUM length, before anything that can take time
    void begin();
    // then the third output is cut down to its length in use (the stored setting): normal frames send data only that
    // far, while the guard reserves the idle draw of the maximum
    void setAuxInUse(size_t length);
    void show(const Rgb *pixels, size_t count) override;
};

}  // namespace melophos
