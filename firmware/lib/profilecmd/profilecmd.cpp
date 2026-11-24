#include "profilecmd.h"

#include <string.h>

#include "textout.h"

namespace melophos {

namespace {

bool failWith(char *reply, size_t cap, const char *why) {
    TextOut o(reply, cap);
    o.raw("{\"ok\":false,\"message\":");
    o.str(why);
    o.raw("}");
    return false;
}

bool word(const char *msg, size_t len, const char *w, const char **rest, size_t *restLen) {
    size_t n = strlen(w);
    if (len < n || memcmp(msg, w, n) != 0 || (len > n && msg[n] != ' ')) {
        return false;
    }
    size_t skip = len > n ? n + 1 : n;
    *rest = msg + skip;
    *restLen = len - skip;
    return true;
}

bool copyId(const char *s, size_t n, char *out) {
    if (n == 0 || n > limits::kIdMax) {
        return false;
    }
    memcpy(out, s, n);
    out[n] = '\0';
    return strlen(out) == n;  // an embedded NUL would shorten it
}

}  // namespace

bool handleProfileCommand(ProfileStore &store, const char *message, size_t length, char *reply, size_t cap,
                          bool *activeChanged) {
    if (activeChanged) {
        *activeChanged = false;
    }
    if (message == nullptr || length == 0 || length > limits::kProfileJsonBytes + 8) {
        return failWith(reply, cap, "the command is empty or too long");
    }
    const char *rest;
    size_t restLen;
    char id[limits::kIdMax + 1];

    if (word(message, length, "list", &rest, &restLen) && restLen == 0) {
        TextOut o(reply, cap);
        char active[limits::kIdMax + 1] = "";
        store.activeId(active, sizeof active);
        o.raw("{\"ok\":true,\"active\":");
        o.str(active);
        o.raw(",\"profiles\":[");
        for (int i = 0; i < store.count(); i++) {
            char pid[limits::kIdMax + 1];
            Profile p;
            if (!store.idAt(i, pid, sizeof pid) || store.load(pid, p) != ProfileStore::Ok) {
                continue;
            }
            if (i) {
                o.raw(",");
            }
            o.raw("{\"id\":");
            o.str(p.id);
            o.raw(",\"name\":");
            o.str(p.name);
            o.raw("}");
        }
        o.raw("]}");
        if (o.overflowed()) {
            return failWith(reply, cap, "the profile list does not fit the reply");
        }
        return true;
    }
    if (word(message, length, "switch", &rest, &restLen)) {
        if (!copyId(rest, restLen, id)) {
            return failWith(reply, cap, "switch needs a profile id of 1 to 32 characters");
        }
        ProfileStore::Status s = store.setActive(id);
        if (s != ProfileStore::Ok) {
            return failWith(reply, cap, ProfileStore::message(s));
        }
        if (activeChanged) {
            *activeChanged = true;
        }
        TextOut o(reply, cap);
        o.raw("{\"ok\":true,\"active\":");
        o.str(id);
        o.raw("}");
        return true;
    }
    if (word(message, length, "remove", &rest, &restLen)) {
        if (!copyId(rest, restLen, id)) {
            return failWith(reply, cap, "remove needs a profile id of 1 to 32 characters");
        }
        char active[limits::kIdMax + 1] = "";
        store.activeId(active, sizeof active);
        ProfileStore::Status s = store.remove(id);
        if (s != ProfileStore::Ok) {
            return failWith(reply, cap, ProfileStore::message(s));
        }
        if (activeChanged && !strcmp(active, id)) {
            *activeChanged = true;  // the hub falls back to the default profile
        }
        TextOut o(reply, cap);
        o.raw("{\"ok\":true}");
        return true;
    }
    if (word(message, length, "put", &rest, &restLen)) {
        Profile p;
        ProfileResult r = parseProfile(rest, restLen, p);
        if (!r.ok) {
            return failWith(reply, cap, r.message);
        }
        char active[limits::kIdMax + 1] = "";
        store.activeId(active, sizeof active);
        ProfileStore::Status s = store.save(p);
        if (s != ProfileStore::Ok) {
            return failWith(reply, cap, ProfileStore::message(s));
        }
        if (activeChanged && !strcmp(active, p.id)) {
            *activeChanged = true;  // the stored copy changed under the running one
        }
        TextOut o(reply, cap);
        o.raw("{\"ok\":true,\"id\":");
        o.str(p.id);
        o.raw("}");
        return true;
    }
    return failWith(reply, cap, "unknown command: use list, switch, put or remove");
}

}  // namespace melophos
