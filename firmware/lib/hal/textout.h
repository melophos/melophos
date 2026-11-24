#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace melophos {

// appends into a caller-owned buffer and never writes past it. A write that
// does not fit sets overflow and leaves the buffer a valid, shorter string.
class TextOut {
   public:
    TextOut(char *buffer, size_t capacity) : buf_(buffer), cap_(capacity) {
        if (cap_) {
            buf_[0] = '\0';
        }
    }
    void raw(const char *s) {
        size_t n = strlen(s);
        if (len_ + n + 1 > cap_) {
            over_ = true;
            return;
        }
        memcpy(buf_ + len_, s, n + 1);
        len_ += n;
    }
    // a JSON string with quotes, escaping what must be escaped
    void str(const char *s) {
        raw("\"");
        for (; *s; s++) {
            unsigned char c = (unsigned char)*s;
            if (c == '"' || c == '\\') {
                char two[3] = {'\\', (char)c, 0};
                raw(two);
            } else if (c < 0x20) {
                char esc[7];
                snprintf(esc, sizeof esc, "\\u%04x", c);
                raw(esc);
            } else {
                char one[2] = {(char)c, 0};
                raw(one);
            }
        }
        raw("\"");
    }
    void num(long long v) {
        char t[24];
        snprintf(t, sizeof t, "%lld", v);
        raw(t);
    }
    size_t length() const { return len_; }
    bool overflowed() const { return over_; }
    void rewind(size_t to) {
        if (to <= len_ && cap_) {
            len_ = to;
            buf_[len_] = '\0';
        }
    }

   private:
    char *buf_;
    size_t cap_;
    size_t len_ = 0;
    bool over_ = false;
};

}  // namespace melophos
