#pragma once

#include <stddef.h>

#include "identity.h"

namespace melophos {

// provisioning commands, one per line (serial today, the Studio later):
//   wifi <ssid> [<password>]    the network. Put a name or password with spaces in double quotes
//   broker <host> [<port>]      the MQTT broker over TLS, port 8883 by default. Port 1883 is the plain
//                               development listener and a TLS connection to it is refused
//   api <host> <port>           the server's HTTPS address, used for pairing (port 443 by default)
//   supply <mA>                 the power adapter's rating, 2500 to 6000. It lowers the LED current ceiling
//   device <id> <secret>        the identity pairing handed out (pairing writes it itself)
//   ca <base64 of the PEM>      the certificate authority that signed the broker's certificate
//   insecure on|off             allow plain MQTT. Development builds only
//   clear device                forget the device id and secret so the hub pairs again
//   clear all                   forget everything above
//   show                        which settings are present. Never prints a secret
// Replies are JSON with "ok" and, when false, a "message" a person can act on.
bool handleProvisionCommand(IdentityStore &store, const char *line, size_t length, char *reply, size_t cap);

}  // namespace melophos
