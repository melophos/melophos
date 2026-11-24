#include "factoryreset.h"

namespace melophos {

bool factoryReset(IdentityStore &identity, Flash &profiles, Flash &outbox) {
    identity.clearAll();
    bool ok = true;
    for (uint32_t s = 0; s < profiles.sectorCount(); s++) {
        ok = profiles.erase(s) && ok;
    }
    for (uint32_t s = 0; s < outbox.sectorCount(); s++) {
        ok = outbox.erase(s) && ok;
    }
    return ok;
}

}  // namespace melophos
