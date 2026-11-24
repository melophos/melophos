#include "tls_transport.h"

#include "melophos_config.h"



#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <mbedtls/x509_crt.h>
#include <string.h>
#include <time.h>

#include "tlscheck.h"

namespace melophos {

namespace {

WiFiClientSecure secureClient;
WiFiClient plainClient;
bool usingPlain = false;
char caPem[idlimits::kCa + 1];

int64_t wallNow() {
    return trustedWallNow();  // never the raw SNTP answer
}

// the dates of every certificate the server sent
const char *checkPeerDates(WiFiClientSecure &c) {  // the CA (caPem) is loaded before this runs
    const mbedtls_x509_crt *cert = c.getPeerCertificate();
    CertValidity chain[kMaxChain + 1];
    size_t n = 0;
    while (cert != nullptr && n <= kMaxChain) {  // one more than the limit, so a longer chain is seen and refused
        chain[n].notBefore = CertTime{cert->valid_from.year, cert->valid_from.mon, cert->valid_from.day,
                                      cert->valid_from.hour, cert->valid_from.min, cert->valid_from.sec};
        chain[n].notAfter = CertTime{cert->valid_to.year, cert->valid_to.mon, cert->valid_to.day, cert->valid_to.hour,
                                     cert->valid_to.min, cert->valid_to.sec};
        n++;
        cert = cert->next;
    }
    // the certificate authority the hub holds is part of the chain it trusts, so its dates are checked too
    mbedtls_x509_crt anchor;
    mbedtls_x509_crt_init(&anchor);
    if (mbedtls_x509_crt_parse(&anchor, reinterpret_cast<const unsigned char *>(caPem), strlen(caPem) + 1) == 0) {
        for (const mbedtls_x509_crt *a = &anchor; a != nullptr && n <= kMaxChain; a = a->next) {
            chain[n].notBefore = CertTime{a->valid_from.year, a->valid_from.mon, a->valid_from.day, a->valid_from.hour, a->valid_from.min, a->valid_from.sec};
            chain[n].notAfter = CertTime{a->valid_to.year, a->valid_to.mon, a->valid_to.day, a->valid_to.hour, a->valid_to.min, a->valid_to.sec};
            n++;
        }
    }
    mbedtls_x509_crt_free(&anchor);
    CertCheck r = checkChain(chain, n, wallNow());
    return r == CertCheck::Ok ? nullptr : certCheckText(r);
}

// connects, verifies the chain and the dates. Returns an error text or nullptr
const char *secureConnectImpl(WiFiClientSecure &c, IdentityStore &identity, const char *host, uint16_t port) {
    if (wallNow() == 0) {
        return certCheckText(CertCheck::NoClock);  // never connect until the date is known
    }
    if (identity.ca(caPem, sizeof caPem) == 0) {
        return "no certificate authority has been provisioned";
    }
    c.stop();
    c.setCACert(caPem);  // with a CA set the library demands a verified chain and the host name
    c.setTimeout(5);
    c.setHandshakeTimeout(10);  // the core's own default is 120 seconds
    if (!c.connect(host, port)) {
        return "the TLS connection failed: the broker, its certificate or its name was not accepted";
    }
    const char *dates = checkPeerDates(c);
    if (dates != nullptr) {
        c.stop();
        return dates;
    }
    return nullptr;
}

}  // namespace

const char *secureConnect(WiFiClientSecure &c, IdentityStore &identity, const char *host, uint16_t port) {
    return secureConnectImpl(c, identity, host, port);
}

bool TlsTransport::open(const char *host, uint16_t port) {
    usingPlain = false;
    error_ = "";
#ifndef MELOPHOS_RELEASE
    if (identity_.insecure()) {
        usingPlain = true;
        plainClient.stop();
        plainClient.setTimeout(5);
        return plainClient.connect(host, port);
    }
#endif
    if (port == kPlainMqttPort) {
        error_ = "port 1883 is the plain development listener: use the TLS port 8883";
        Serial.printf("mqtt: %s\n", error_);
        return false;
    }
    error_ = secureConnectImpl(secureClient, identity_, host, port);
    if (error_ != nullptr) {
        Serial.printf("mqtt: %s\n", error_);
        return false;
    }
    error_ = "";
    return true;
}

int TlsTransport::read(uint8_t *out, size_t cap) {
    WiFiClient &c = usingPlain ? static_cast<WiFiClient &>(plainClient) : static_cast<WiFiClient &>(secureClient);
    int avail = c.available();
    if (avail > 0) {
        return c.read(out, cap > (size_t)avail ? (size_t)avail : cap);
    }
    return c.connected() ? 0 : -1;
}

bool TlsTransport::write(const uint8_t *data, size_t length) {
    WiFiClient &c = usingPlain ? static_cast<WiFiClient &>(plainClient) : static_cast<WiFiClient &>(secureClient);
    return c.write(data, length) == length;
}

void TlsTransport::close() {
    plainClient.stop();
    secureClient.stop();
}

bool TlsTransport::isOpen() {
    return usingPlain ? plainClient.connected() : secureClient.connected();
}

void TlsTransport::idle() {
    delay(1);
}

bool HttpsApi::call(const char *method, const char *path, const char *auth, HttpReply &out) {
    out.status = 0;
    out.length = 0;
    out.retryAfterS = 0;
    char host[80];
    uint16_t port;
    if (!identity_.api(host, sizeof host, port)) {
        error_ = "the server address has not been provisioned";
        return false;
    }
    WiFiClientSecure client;
    error_ = secureConnect(client, identity_, host, port);  // the same checks as the broker's
    if (error_ != nullptr) {
        return false;
    }
    HTTPClient http;
    http.setConnectTimeout(8000);
    http.setTimeout(10000);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);  // a redirect could leave the verified host
    const char *keys[] = {"Retry-After"};
    http.collectHeaders(keys, 1);
    if (!http.begin(client, host, port, path, true)) {
        error_ = "the request could not start";
        return false;
    }
    if (auth) {
        http.addHeader("Authorization", auth);
    }
    int code = !strcmp(method, "POST") ? http.POST((uint8_t *)"", 0) : !strcmp(method, "DELETE") ? http.sendRequest("DELETE") : http.GET();
    if (code <= 0) {
        http.end();
        error_ = "the server did not answer";
        return false;
    }
    out.status = code;
    if (http.hasHeader("Retry-After")) {
        out.retryAfterS = (uint32_t)http.header("Retry-After").toInt();
    }
    String body = http.getString();
    out.length = body.length() < sizeof out.body ? body.length() : sizeof out.body - 1;  // a longer body is cut and then fails to parse
    memcpy(out.body, body.c_str(), out.length);
    http.end();
    return true;
}

bool HttpsApi::requestIdentity(HttpReply &out) {
    return call("POST", "/api/v1/pairing", nullptr, out);
}

bool HttpsApi::checkDevice(const char *id, const char *secret, HttpReply &out) {
    char auth[170];
    snprintf(auth, sizeof auth, "Device %s:%s", id, secret);
    return call("GET", "/api/v1/device", auth, out);
}

bool HttpsApi::removeClaim(const char *id, const char *secret, HttpReply &out) {
    char auth[170];
    snprintf(auth, sizeof auth, "Device %s:%s", id, secret);
    return call("DELETE", "/api/v1/device/claim", auth, out);
}

}  // namespace melophos
