#include "provision.h"

#include "hal.h"

#include <stdio.h>
#include <string.h>

#include <new>

namespace melophos {

namespace {

bool fail(char *reply, size_t cap, const char *why) {
    snprintf(reply, cap, "{\"ok\":false,\"message\":\"%s\"}", why);
    return false;
}

bool ok(char *reply, size_t cap) {
    snprintf(reply, cap, "{\"ok\":true}");
    return true;
}

// splits at the first space. Returns false when there is no word
bool nextWord(const char *&p, const char *end, char *out, size_t cap) {
    while (p < end && *p == ' ') {
        p++;
    }
    size_t n = 0;
    if (p < end && *p == '"') {
        // a quoted word may hold spaces: wifi "Home Net" "a long password"
        p++;
        while (p < end && *p != '"') {
            if (n + 1 >= cap) {
                return false;
            }
            out[n++] = *p++;
        }
        if (p >= end) {
            return false;  // the quote never closed
        }
        p++;  // the closing quote
        out[n] = '\0';
        return n > 0;
    }
    while (p < end && *p != ' ') {
        if (n + 1 >= cap) {
            return false;
        }
        out[n++] = *p++;
    }
    out[n] = '\0';
    return n > 0;
}

}  // namespace

bool handleProvisionCommand(IdentityStore &store, const char *line, size_t length, char *reply, size_t cap) {
    if (line == nullptr || length == 0 || length > idlimits::kCa * 4 / 3 + 16) {
        return fail(reply, cap, "the command is empty or too long");
    }
    for (size_t i = 0; i < length; i++) {
        if ((unsigned char)line[i] < 0x20 || (unsigned char)line[i] > 0x7E) {
            return fail(reply, cap, "the command has a character that is not printable");
        }
    }
    const char *p = line;
    const char *end = line + length;
    char verb[16];
    if (!nextWord(p, end, verb, sizeof verb)) {
        return fail(reply, cap, "unknown command: use wifi, broker, api, supply, device, ca, clear or show");
    }
    const char *why = "";
    if (!strcmp(verb, "wifi")) {
        char ssid[40], pass[80];
        pass[0] = '\0';
        if (!nextWord(p, end, ssid, sizeof ssid)) {
            return fail(reply, cap, "wifi needs a network name");
        }
        nextWord(p, end, pass, sizeof pass);
        return store.setWifi(ssid, pass, &why) ? ok(reply, cap) : fail(reply, cap, why);
    }
    if (!strcmp(verb, "broker")) {
        char host[80], port[12];
        if (!nextWord(p, end, host, sizeof host)) {
            return fail(reply, cap, "broker needs a host and an optional port");
        }
        if (!nextWord(p, end, port, sizeof port)) {
            strcpy(port, "8883");  // the TLS port
        }
        uint32_t parsed = 0;
        if (!parseUnsigned(port, 65535, parsed) || parsed < 1) {
            return fail(reply, cap, "the port must be a number from 1 to 65535");
        }
        long v = (long)parsed;
        return store.setBroker(host, v, &why) ? ok(reply, cap) : fail(reply, cap, why);
    }
    if (!strcmp(verb, "api")) {
        char host[80], port[12];
        if (!nextWord(p, end, host, sizeof host)) {
            return fail(reply, cap, "api needs a host and an optional port");
        }
        if (!nextWord(p, end, port, sizeof port)) {
            strcpy(port, "443");
        }
        uint32_t parsed = 0;
        if (!parseUnsigned(port, 65535, parsed) || parsed < 1) {
            return fail(reply, cap, "the port must be a number from 1 to 65535");
        }
        long v = (long)parsed;
        return store.setApi(host, v, &why) ? ok(reply, cap) : fail(reply, cap, why);
    }
    if (!strcmp(verb, "supply")) {
        char ma[12];
        if (!nextWord(p, end, ma, sizeof ma)) {
            return fail(reply, cap, "supply needs the adapter's rating in mA, for example 3000");
        }
        uint32_t parsed = 0;
        if (!parseUnsigned(ma, 100000, parsed)) {
            return fail(reply, cap, "the rating must be a number of mA");
        }
        long v = (long)parsed;
        return store.setSupplyMa(v, &why) ? ok(reply, cap) : fail(reply, cap, why);
    }
    if (!strcmp(verb, "device")) {
        char id[80], secret[80];
        if (!nextWord(p, end, id, sizeof id) || !nextWord(p, end, secret, sizeof secret)) {
            return fail(reply, cap, "device needs an id and a secret");
        }
        return store.setDevice(id, secret, &why) ? ok(reply, cap) : fail(reply, cap, why);
    }
    if (!strcmp(verb, "ca")) {
        // heap for this one command: the buffers are too big to keep as static data on the classic ESP32
        const size_t b64Cap = idlimits::kCa * 4 / 3 + 8;
        char *b64 = new (std::nothrow) char[b64Cap];
        uint8_t *pem = new (std::nothrow) uint8_t[idlimits::kCa + 8];
        bool done = false;
        const char *message = "out of memory";
        if (b64 && pem) {
            if (!nextWord(p, end, b64, b64Cap)) {
                message = "ca needs the certificate as one line of base64";
            } else {
                size_t n = base64Decode(b64, strlen(b64), pem, idlimits::kCa + 7);
                if (n == 0) {
                    message = "the certificate is not valid base64";
                } else {
                    pem[n] = 0;
                    done = store.setCa((const char *)pem, n, &why);
                    message = why;
                }
            }
        }
        delete[] b64;
        delete[] pem;
        return done ? ok(reply, cap) : fail(reply, cap, message);
    }
#ifndef MELOPHOS_RELEASE
    if (!strcmp(verb, "insecure")) {
        char v[8];
        if (!nextWord(p, end, v, sizeof v) || (strcmp(v, "on") != 0 && strcmp(v, "off") != 0)) {
            return fail(reply, cap, "insecure needs on or off");
        }
        return store.setInsecure(!strcmp(v, "on"), &why) ? ok(reply, cap) : fail(reply, cap, why);
    }
#endif
    if (!strcmp(verb, "clear")) {
        char what[8];
        if (!nextWord(p, end, what, sizeof what)) {
            return fail(reply, cap, "clear needs device or all");
        }
        if (!strcmp(what, "device")) {
            store.clearDevice();
            return ok(reply, cap);
        }
        if (!strcmp(what, "all")) {
            store.clearAll();
            return ok(reply, cap);
        }
        return fail(reply, cap, "clear needs device or all");
    }
    if (!strcmp(verb, "show")) {
        char a[40], b[80], h[80], i[80], s[80];
        uint16_t port = 0;
        bool w = store.wifi(a, sizeof a, b, sizeof b);
        bool br = store.broker(h, sizeof h, port);
        bool d = store.device(i, sizeof i, s, sizeof s);
        bool c = store.hasCa();
#ifdef MELOPHOS_RELEASE
        snprintf(reply, cap, "{\"ok\":true,\"wifi\":%s,\"broker\":%s,\"device\":%s,\"ca\":%s}", w ? "true" : "false", br ? "true" : "false",
                 d ? "true" : "false", c ? "true" : "false");
#else
        snprintf(reply, cap, "{\"ok\":true,\"wifi\":%s,\"broker\":%s,\"device\":%s,\"ca\":%s,\"insecure\":%s}", w ? "true" : "false",
                 br ? "true" : "false", d ? "true" : "false", c ? "true" : "false", store.insecure() ? "true" : "false");
#endif
        return true;
    }
#ifdef MELOPHOS_RELEASE
    return fail(reply, cap, "unknown command: use wifi, broker, api, supply, device, ca, clear or show");
#else
    return fail(reply, cap, "unknown command: use wifi, broker, api, supply, device, ca, insecure, clear or show");
#endif
}

}  // namespace melophos
