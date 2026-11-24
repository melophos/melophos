#pragma once

#include "hal.h"
#include "identity.h"

namespace melophos {

// what a factory reset removes: everything the owner or the pairing flow put on the hub (Wi-Fi, broker,
// certificate authority, device identity), every stored profile and the saved last session, so the
// previous player's practice does not go to the next owner's account. The Wi-Fi driver's own saved
// copy of the network is cleared by the board code (it is never written: persistent mode is off).
// It KEEPS the boot counter and the update version floor, which must never go backwards.
// Returns false if any sector could not be erased.
bool factoryReset(IdentityStore &identity, Flash &profiles, Flash &outbox);

}  // namespace melophos
