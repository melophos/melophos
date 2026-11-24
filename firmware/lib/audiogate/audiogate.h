#pragma once

#include <stddef.h>

namespace melophos {

// the audio converter needs more than the 5 V rail gives on USB-C power alone
// (it sits near 4.4 V there, under the converter's minimum). So audio input is
// allowed only while the DC inlet is present. The board's SENSE_5V line says
// whether it is. Nothing in hardware/ yet gives the pin, the polarity or whether
// it is a logic level or a divided voltage, so the pin and polarity in
// melophos_config.h are provisional and must be checked against the schematic.
class AudioControl {
   public:
    // the reason shown when audio is refused or switched off
    static const char *refusal() {
        return "audio input needs the DC power inlet: on USB-C power alone the 5 V rail is too low for the audio converter";
    }
    // turns audio on or off. Returns whether the request was granted and fills a JSON reply
    // {"ok":true,"audio":"on"} or {"ok":false,"message":"..."} for the Studio and serial
    bool request(bool wantOn, bool dcInletPresent, char *reply, size_t cap);
    // call every loop pass with the current SENSE_5V reading. Returns true when audio was
    // just switched off because the inlet went away, with the same JSON in reply
    bool poll(bool dcInletPresent, char *reply, size_t cap);
    bool on() const { return on_; }

   private:
    bool on_ = false;
};

}  // namespace melophos
