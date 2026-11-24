#pragma once

#include <stdint.h>

#include "encoder.h"

namespace melophos {

// the rotary encoder on the board: ENC_A, ENC_B and the push switch ENC_SW. The pins are read every millisecond by
// a small task (a quick turn makes a transition every few milliseconds, which the 20 ms loop would miss) and fed
// to the tested decoders in lib/encoder. The events wait in a short queue. Nothing in the firmware reads them yet.
// Compile-only: it awaits a board.
class Encoder {
   public:
    void begin();
    // false when there is nothing waiting
    bool next(EncoderEvent &out);
    // a reader that attaches late starts from now: everything queued before is dropped
    void startFromNow();
    uint32_t dropped();
};

}  // namespace melophos
