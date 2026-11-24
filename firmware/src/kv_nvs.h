#pragma once

#include "identity.h"

namespace melophos {

// the key value store behind IdentityStore: the ESP32's NVS, in its own
// namespace. NVS is NOT encrypted on this build, see firmware/README.md.
class NvsStore : public KeyValueStore {
   public:
    bool get(const char *key, char *out, size_t cap, size_t &length) override;
    bool put(const char *key, const char *value, size_t length) override;
    bool erase(const char *key) override;
};

}  // namespace melophos
