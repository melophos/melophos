#pragma once

#include <WiFiClientSecure.h>

#include "identity.h"
#include "mqttwire.h"
#include "pairing.h"

namespace melophos {

// TLS to the broker and to the server's HTTPS API. The broker's certificate
// chain is verified against the certificate authority the owner provisioned
// (never compiled in). After the handshake every certificate the server
// presented has its validity dates checked here, because this core's mbedTLS
// has date checking compiled out (see lib/tlscheck). Without a set clock the
// connection is refused, so the hub waits for SNTP before it connects.
//
// Plain connections exist only in a development build and only when the
// owner has switched on the insecure flag. A release build has no such path.
//
// Compiles for the board. It has never run on one: see docs/mqtt.md.
// the hub's trusted wall time, from the ClockGuard (0 until it is believed). Defined in network_esp.cpp
int64_t trustedWallNow();

// connects with the same checks as the broker: the chain against the owner's authority, the host name,
// every certificate's dates and the clock. Returns an error text or nullptr. Used by the update fetcher too
const char *secureConnect(WiFiClientSecure &c, IdentityStore &identity, const char *host, uint16_t port);

class TlsTransport : public Transport {
   public:
    explicit TlsTransport(IdentityStore &identity) : identity_(identity) {}
    bool open(const char *host, uint16_t port) override;
    int read(uint8_t *out, size_t cap) override;
    bool write(const uint8_t *data, size_t length) override;
    void close() override;
    bool isOpen() override;
    void idle() override;
    // why the last open failed, for the serial log
    const char *lastError() const { return error_; }

   private:
    IdentityStore &identity_;
    const char *error_ = "";
};

class HttpsApi : public HttpsPort {
   public:
    explicit HttpsApi(IdentityStore &identity) : identity_(identity) {}
    bool requestIdentity(HttpReply &out) override;
    bool checkDevice(const char *id, const char *secret, HttpReply &out) override;
    bool removeClaim(const char *id, const char *secret, HttpReply &out) override;
    const char *lastError() const { return error_; }

   private:
    IdentityStore &identity_;
    const char *error_ = "";
    bool call(const char *method, const char *path, const char *auth, HttpReply &out);
};

}  // namespace melophos
