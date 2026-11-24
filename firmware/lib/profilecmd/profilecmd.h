#pragma once

#include <stddef.h>

#include "profilestore.h"

namespace melophos {

// the Studio's profile commands, one per message:
//   list                 {"ok":true,"active":"id","profiles":[{"id":..,"name":..}]}
//   switch <id>          make a stored profile the active one
//   put <profile json>   validate against the schema limits and store
//   remove <id>          delete a stored profile
// Every reply is JSON with "ok" and, when false, a "message" a person can act
// on. Returns true when the command succeeded. A switch or put of the active
// profile sets switched so the caller can reload the LED mapping.
bool handleProfileCommand(ProfileStore &store, const char *message, size_t length, char *reply, size_t cap,
                          bool *activeChanged);

}  // namespace melophos
