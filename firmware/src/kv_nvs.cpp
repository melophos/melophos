#include "kv_nvs.h"

#include <Preferences.h>

namespace melophos {

namespace {
const char *kNamespace = "melophos";
}

bool NvsStore::get(const char *key, char *out, size_t cap, size_t &length) {
    Preferences p;
    length = 0;
    if (!p.begin(kNamespace, true)) {
        return false;
    }
    size_t n = p.getBytesLength(key);
    bool ok = n > 0 && n <= cap && p.getBytes(key, out, n) == n;
    p.end();
    length = ok ? n : 0;
    return ok;
}

bool NvsStore::put(const char *key, const char *value, size_t length) {
    Preferences p;
    if (!p.begin(kNamespace, false)) {
        return false;
    }
    // an empty value is not stored: callers erase the key instead, so "empty" and "missing" are the same
    bool ok = length == 0 ? false : p.putBytes(key, value, length) == length;
    p.end();
    return ok;
}

bool NvsStore::erase(const char *key) {
    Preferences p;
    if (!p.begin(kNamespace, false)) {
        return false;
    }
    p.remove(key);
    p.end();
    return true;
}

}  // namespace melophos
