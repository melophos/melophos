#include "identity.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <new>

namespace melophos {

namespace {

bool printable(const char *s, size_t minLen, size_t maxLen) {
    size_t n = strlen(s);
    if (n < minLen || n > maxLen) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        if ((unsigned char)s[i] < 0x20 || (unsigned char)s[i] > 0x7E) {
            return false;
        }
    }
    return true;
}

bool hostChars(const char *s) {
    size_t n = strlen(s);
    if (n == 0 || n > idlimits::kHost) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-';
        if (!ok) {
            return false;
        }
    }
    return true;
}

bool idChars(const char *s) {
    size_t n = strlen(s);
    if (n < 3 || n > idlimits::kDeviceId) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        bool alnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        if (!(alnum || (c == '-' && i > 0))) {
            return false;
        }
    }
    return true;
}

}  // namespace

bool validPem(const char *pem, size_t length) {
    static const char begin[] = "-----BEGIN CERTIFICATE-----";
    static const char end[] = "-----END CERTIFICATE-----";
    if (pem == nullptr || length < 60 || length > idlimits::kCa) {
        return false;
    }
    for (size_t i = 0; i < length; i++) {
        unsigned char c = (unsigned char)pem[i];
        bool ok = c == '\n' || c == '\r' || (c >= 0x20 && c < 0x7F);
        if (!ok) {
            return false;  // includes a NUL inside the text
        }
    }
    if (strncmp(pem, begin, sizeof begin - 1) != 0) {
        return false;
    }
    // the text must end with the closing line, optionally followed by a newline
    size_t trimmed = length;
    while (trimmed > 0 && (pem[trimmed - 1] == '\n' || pem[trimmed - 1] == '\r')) {
        trimmed--;
    }
    return trimmed >= sizeof end - 1 && memcmp(pem + trimmed - (sizeof end - 1), end, sizeof end - 1) == 0;
}

size_t base64Decode(const char *in, size_t length, uint8_t *out, size_t cap) {
    size_t at = 0;
    uint32_t acc = 0;
    int bits = 0;
    size_t pad = 0;
    for (size_t i = 0; i < length; i++) {
        char c = in[i];
        int v;
        if (c >= 'A' && c <= 'Z') {
            v = c - 'A';
        } else if (c >= 'a' && c <= 'z') {
            v = c - 'a' + 26;
        } else if (c >= '0' && c <= '9') {
            v = c - '0' + 52;
        } else if (c == '+') {
            v = 62;
        } else if (c == '/') {
            v = 63;
        } else if (c == '=') {
            pad++;
            continue;
        } else {
            return 0;
        }
        if (pad > 0) {
            return 0;  // data after padding
        }
        acc = (acc << 6) | (uint32_t)v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (at >= cap) {
                return 0;
            }
            out[at++] = (uint8_t)(acc >> bits);
            acc &= (1u << bits) - 1;
        }
    }
    return pad <= 2 ? at : 0;
}

bool IdentityStore::setWifi(const char *ssid, const char *password, const char **why) {
    if (!ssid || !password || !printable(ssid, 1, idlimits::kSsid)) {
        *why = "the Wi-Fi name must be 1 to 32 printable characters";
        return false;
    }
    if (!(strlen(password) == 0 || printable(password, 8, idlimits::kWifiPassword))) {
        *why = "the Wi-Fi password must be empty or 8 to 63 printable characters";
        return false;
    }
    // an open network has no password: the key is removed, an empty value is never stored
    bool passOk = strlen(password) == 0 ? kv_.erase("wifi_pass") : kv_.put("wifi_pass", password, strlen(password));
    if (!kv_.put("wifi_ssid", ssid, strlen(ssid)) || !passOk) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
}

bool IdentityStore::setBroker(const char *host, long port, const char **why) {
    if (!host || !hostChars(host) || port < 1 || port > 65535) {
        *why = "the broker needs a host name and a port from 1 to 65535";
        return false;
    }
    char p[8];
    int n = 0;
    long v = port;
    char tmp[8];
    while (v > 0) {
        tmp[n++] = (char)('0' + v % 10);
        v /= 10;
    }
    for (int i = 0; i < n; i++) {
        p[i] = tmp[n - 1 - i];
    }
    p[n] = '\0';
    if (!kv_.put("broker_host", host, strlen(host)) || !kv_.put("broker_port", p, (size_t)n)) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
}

bool IdentityStore::setApi(const char *host, long port, const char **why) {
    if (!host || !hostChars(host) || port < 1 || port > 65535) {
        *why = "the server needs a host name and a port from 1 to 65535";
        return false;
    }
    char p[8];
    snprintf(p, sizeof p, "%ld", port);
    if (!kv_.put("api_host", host, strlen(host)) || !kv_.put("api_port", p, strlen(p))) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
}

bool IdentityStore::api(char *host, size_t cap, uint16_t &port) {
    size_t n = 0, m = 0;
    char p[8] = "";
    if (!kv_.get("api_host", host, cap - 1, n) || n == 0 || !kv_.get("api_port", p, sizeof p - 1, m) || m == 0) {
        return false;
    }
    host[n] = '\0';
    p[m] = '\0';
    long v = atol(p);
    if (v < 1 || v > 65535 || !hostChars(host)) {
        return false;
    }
    port = (uint16_t)v;
    return true;
}

bool IdentityStore::setDevice(const char *id, const char *secret, const char **why) {
    if (!id || !secret || !idChars(id) || !printable(secret, 8, idlimits::kSecret)) {
        *why = "the device id must be 3 to 64 lower case letters, digits or dashes and the secret 8 to 64 printable characters";
        return false;
    }
    if (!kv_.put("dev_id", id, strlen(id)) || !kv_.put("dev_secret", secret, strlen(secret))) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
}

bool IdentityStore::setCa(const char *pem, size_t length, const char **why) {
    if (!validPem(pem, length)) {
        *why = "the certificate authority must be a PEM certificate of at most 3000 characters";
        return false;
    }
    if (!kv_.put("broker_ca", pem, length)) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
}

bool IdentityStore::setInsecure(bool on, const char **why) {
#ifdef MELOPHOS_RELEASE
    (void)on;
    *why = "a release build never talks to the broker without TLS";
    return false;
#else
    if (on ? !kv_.put("insecure", "1", 1) : !kv_.erase("insecure")) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
#endif
}

bool IdentityStore::wifi(char *ssid, size_t ssidCap, char *password, size_t passCap) {
    size_t a = 0, b = 0;
    if (!kv_.get("wifi_ssid", ssid, ssidCap - 1, a) || a == 0) {
        return false;
    }
    ssid[a] = '\0';
    if (!kv_.get("wifi_pass", password, passCap - 1, b)) {
        b = 0;
    }
    password[b] = '\0';
    return true;
}

bool IdentityStore::broker(char *host, size_t cap, uint16_t &port) {
    size_t n = 0, m = 0;
    char p[8] = "";
    if (!kv_.get("broker_host", host, cap - 1, n) || n == 0 || !kv_.get("broker_port", p, sizeof p - 1, m) || m == 0) {
        return false;
    }
    host[n] = '\0';
    p[m] = '\0';
    long v = 0;
    for (size_t i = 0; i < m; i++) {
        if (p[i] < '0' || p[i] > '9') {
            return false;
        }
        v = v * 10 + (p[i] - '0');
    }
    if (v < 1 || v > 65535 || !hostChars(host)) {
        return false;
    }
    port = (uint16_t)v;
    return true;
}

bool IdentityStore::device(char *id, size_t idCap, char *secret, size_t secretCap) {
    size_t a = 0, b = 0;
    if (!kv_.get("dev_id", id, idCap - 1, a) || !kv_.get("dev_secret", secret, secretCap - 1, b)) {
        return false;
    }
    id[a] = '\0';
    secret[b] = '\0';
    return idChars(id) && printable(secret, 8, idlimits::kSecret);
}

size_t IdentityStore::ca(char *out, size_t cap) {
    size_t n = 0;
    if (cap < 2 || !kv_.get("broker_ca", out, cap - 1, n) || !validPem(out, n)) {
        return 0;
    }
    out[n] = '\0';
    return n;
}

uint16_t IdentityStore::auxLength(uint16_t maxLeds, uint16_t fallback) {
    char c[8];
    size_t n = 0;
    if (!kv_.get("aux_len", c, sizeof c - 1, n) || n == 0) {
        return fallback > maxLeds ? maxLeds : fallback;
    }
    unsigned v = 0;
    for (size_t i = 0; i < n; i++) {
        if (c[i] < '0' || c[i] > '9') {
            return fallback > maxLeds ? maxLeds : fallback;
        }
        v = v * 10 + (unsigned)(c[i] - '0');
    }
    return v > maxLeds ? (fallback > maxLeds ? maxLeds : fallback) : (uint16_t)v;
}

bool IdentityStore::setAuxLength(uint16_t length, uint16_t maxLeds, const char **why) {
    if (length > maxLeds) {
        *why = "the third output cannot be longer than the longest strip the hub supports";
        return false;
    }
    char text[8];
    int n = snprintf(text, sizeof text, "%u", (unsigned)length);
    if (n <= 0 || !kv_.put("aux_len", text, (size_t)n)) {
        *why = "the length could not be saved to flash, so the stored length is unchanged";
        return false;
    }
    char back[8];
    size_t got = 0;
    if (!kv_.get("aux_len", back, sizeof back, got) || got != (size_t)n || memcmp(back, text, got) != 0) {
        // the write returned success but what is stored could not be confirmed: it may be the new value after a restart
        *why = "the length was written but could not be read back: the length in use now is unchanged, the stored length could not be confirmed and may take effect after a restart. Check it with a restart";
        return false;
    }
    return true;
}

bool IdentityStore::soundOn() {
    char c[2];
    size_t n = 0;
    return kv_.get("sound", c, 1, n) && n == 1 && c[0] == '1';
}

bool IdentityStore::setSoundOn(bool on) {
    if (on) {
        return kv_.put("sound", "1", 1) && soundOn();  // true only when it reads back
    }
    kv_.erase("sound");
    return !soundOn();  // true only when the setting is really gone
}

bool IdentityStore::insecure() {
#ifdef MELOPHOS_RELEASE
    return false;  // whatever is in storage is ignored
#else
    char c[2];
    size_t n = 0;
    return kv_.get("insecure", c, 1, n) && n == 1 && c[0] == '1';
#endif
}

bool IdentityStore::hasCa() {
    char *pem = new (std::nothrow) char[idlimits::kCa + 1];  // heap: too big for static data on the classic ESP32
    if (pem == nullptr) {
        return false;
    }
    bool ok = ca(pem, idlimits::kCa + 1) > 0;
    delete[] pem;
    return ok;
}

bool IdentityStore::readyForTls() {
    char a[40], b[70], h[70], i[70], s[70];
    uint16_t port;
    return wifi(a, sizeof a, b, sizeof b) && broker(h, sizeof h, port) && port != kPlainMqttPort && device(i, sizeof i, s, sizeof s) && hasCa();
}

bool IdentityStore::readyInsecure() {
    char a[40], b[70], h[70], i[70], s[70];
    uint16_t port;
    return insecure() && wifi(a, sizeof a, b, sizeof b) && broker(h, sizeof h, port) && device(i, sizeof i, s, sizeof s);
}

bool IdentityStore::setSupplyMa(long ma, const char **why) {
    if (ma < 2500 || ma > 6000) {
        *why = "the supply rating must be from 2500 to 6000 mA: the board needs at least a 2.5 A adapter";
        return false;
    }
    char t[8];
    snprintf(t, sizeof t, "%ld", ma);
    if (!kv_.put("supply_ma", t, strlen(t))) {
        *why = "the settings could not be saved";
        return false;
    }
    return true;
}

uint16_t IdentityStore::supplyMa() {
    char t[8];
    size_t n = 0;
    if (!kv_.get("supply_ma", t, sizeof t - 1, n) || n == 0) {
        return 5000;  // the board as specified: a 5 A supply
    }
    t[n] = '\0';
    long v = atol(t);
    return (v >= 2500 && v <= 6000) ? (uint16_t)v : 5000;
}

bool IdentityStore::setPaired(bool on) {
    return on ? kv_.put("paired", "1", 1) : kv_.erase("paired");
}

bool IdentityStore::paired() {
    char c[2];
    size_t n = 0;
    return kv_.get("paired", c, 1, n) && n == 1 && c[0] == '1';
}

bool IdentityStore::setPairWindow(int64_t startEpoch, uint32_t count) {
    char t[40];
    int n = snprintf(t, sizeof t, "%lld %lu", (long long)startEpoch, (unsigned long)count);
    return n > 0 && kv_.put("pair_win", t, (size_t)n);
}

bool IdentityStore::pairWindow(int64_t &startEpoch, uint32_t &count) {
    char t[40];
    size_t n = 0;
    if (!kv_.get("pair_win", t, sizeof t - 1, n) || n == 0) {
        return false;
    }
    t[n] = '\0';
    long long a = 0;
    unsigned long b = 0;
    if (sscanf(t, "%lld %lu", &a, &b) != 2 || a < 0 || b > 1000) {
        return false;
    }
    startEpoch = a;
    count = (uint32_t)b;
    return true;
}

bool IdentityStore::setPairingCode(const char *code) {
    return code && strlen(code) >= 4 && strlen(code) <= 15 && kv_.put("pair_code", code, strlen(code));
}

bool IdentityStore::pairingCode(char *out, size_t cap) {
    size_t n = 0;
    if (cap < 2 || !kv_.get("pair_code", out, cap - 1, n) || n == 0) {
        return false;
    }
    out[n] = '\0';
    return true;
}

void IdentityStore::clearDevice() {
    kv_.erase("dev_id");
    kv_.erase("dev_secret");
    kv_.erase("paired");
    kv_.erase("pair_code");
}

void IdentityStore::clearAll() {
    static const char *keys[] = {"wifi_ssid", "wifi_pass", "broker_host", "broker_port", "api_host", "api_port", "supply_ma", "pair_win", "paired", "pair_code", "dev_id", "dev_secret", "broker_ca", "insecure", "ble_ok", "sound", "aux_len"};
    for (const char *k : keys) {
        kv_.erase(k);
    }
}

}  // namespace melophos
