#include "audiogate.h"

#include <stdio.h>

namespace melophos {

bool AudioControl::request(bool wantOn, bool dc, char *reply, size_t cap) {
    if (!wantOn) {
        on_ = false;
        snprintf(reply, cap, "{\"ok\":true,\"audio\":\"off\"}");
        return true;
    }
    if (!dc) {
        on_ = false;
        snprintf(reply, cap, "{\"ok\":false,\"message\":\"%s\"}", refusal());
        return false;
    }
    on_ = true;
    snprintf(reply, cap, "{\"ok\":true,\"audio\":\"on\"}");
    return true;
}

bool AudioControl::poll(bool dc, char *reply, size_t cap) {
    if (on_ && !dc) {
        on_ = false;
        snprintf(reply, cap, "{\"ok\":false,\"audio\":\"off\",\"message\":\"%s\"}", refusal());
        return true;
    }
    return false;
}

}  // namespace melophos
