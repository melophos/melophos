#include "jsonlite.h"

#include <stdio.h>
#include <string.h>

namespace melophos {

namespace {

const size_t kPathMax = 64;

class Walker {
   public:
    Walker(const char *t, size_t n, const JsonLimits &l, JsonSink &s) : p_(t), end_(t + n), limits_(l), sink_(s) {}

    JsonResult run() {
        JsonResult result{true, ""};
        path_[0] = '\0';
        if (!value(0, 0)) {
            result.ok = false;
            snprintf(result.message, sizeof result.message, "%s", error_[0] ? error_ : "not valid JSON");
            return result;
        }
        skipSpace();
        if (p_ != end_) {
            result.ok = false;
            snprintf(result.message, sizeof result.message, "extra content after the document");
        }
        return result;
    }

   private:
    const char *p_;
    const char *end_;
    const JsonLimits &limits_;
    JsonSink &sink_;
    char path_[kPathMax];
    char scratch_[96];
    char error_[80] = "";

    bool fail(const char *message) {
        if (!error_[0]) {
            snprintf(error_, sizeof error_, "%s", message);
        }
        return false;
    }

    void skipSpace() {
        while (p_ < end_ && (*p_ == ' ' || *p_ == '\t' || *p_ == '\n' || *p_ == '\r')) {
            p_++;
        }
    }

    bool literal(const char *word) {
        size_t n = strlen(word);
        if ((size_t)(end_ - p_) < n || memcmp(p_, word, n) != 0) {
            return fail("not valid JSON");
        }
        p_ += n;
        return true;
    }

    // copies a string into out, which holds limits_.maxString + 1 bytes at most
    bool string(char *out, size_t cap) {
        p_++;  // opening quote
        size_t n = 0;
        while (p_ < end_ && *p_ != '"') {
            unsigned char c = (unsigned char)*p_;
            if (c < 0x20) {
                return fail("control character inside a string");
            }
            if (c == '\\') {
                return fail("string escapes are not supported");
            }
            if (n >= limits_.maxString || n + 1 >= cap) {
                return fail("a string is too long");
            }
            out[n++] = (char)c;
            p_++;
        }
        if (p_ >= end_) {
            return fail("a string is not closed");
        }
        p_++;
        out[n] = '\0';
        return true;
    }

    bool number(double &out) {
        bool negative = false;
        if (p_ < end_ && *p_ == '-') {
            negative = true;
            p_++;
        }
        double whole = 0;
        int digits = 0;
        while (p_ < end_ && *p_ >= '0' && *p_ <= '9') {
            whole = whole * 10 + (*p_ - '0');
            digits++;
            p_++;
            if (digits > 12) {
                return fail("a number has too many digits");
            }
        }
        if (digits == 0) {
            return fail("not valid JSON");
        }
        double fraction = 0;
        if (p_ < end_ && *p_ == '.') {
            p_++;
            double scale = 0.1;
            int places = 0;
            while (p_ < end_ && *p_ >= '0' && *p_ <= '9') {
                fraction += (*p_ - '0') * scale;
                scale /= 10;
                p_++;
                if (++places > 6) {
                    return fail("a number has too many decimal places");
                }
            }
            if (places == 0) {
                return fail("not valid JSON");
            }
        }
        if (p_ < end_ && (*p_ == 'e' || *p_ == 'E')) {
            return fail("exponent numbers are not supported");
        }
        out = whole + fraction;
        if (negative) {
            out = -out;
        }
        return true;
    }

    bool emit(JsonKind kind, const char *text, double num, bool flag) {
        if (!sink_.leaf(path_, kind, text, num, flag)) {
            return fail("the value was refused");
        }
        return true;
    }

    bool value(int depth, size_t pathLen) {
        if (depth > limits_.maxDepth) {
            return fail("the document is nested too deeply");
        }
        skipSpace();
        if (p_ >= end_) {
            return fail("the document ends too early");
        }
        char c = *p_;
        if (c == '{') {
            return object(depth, pathLen);
        }
        if (c == '[') {
            return array(depth, pathLen);
        }
        if (c == '"') {
            if (!string(scratch_, sizeof scratch_)) {
                return false;
            }
            return emit(JsonKind::String, scratch_, 0, false);
        }
        if (c == 't') {
            return literal("true") && emit(JsonKind::Bool, "", 0, true);
        }
        if (c == 'f') {
            return literal("false") && emit(JsonKind::Bool, "", 0, false);
        }
        if (c == 'n') {
            return literal("null") && emit(JsonKind::Null, "", 0, false);
        }
        double num = 0;
        if (!number(num)) {
            return false;
        }
        return emit(JsonKind::Number, "", num, false);
    }

    bool object(int depth, size_t pathLen) {
        p_++;
        skipSpace();
        if (p_ < end_ && *p_ == '}') {
            p_++;
            return true;
        }
        char key[48];
        for (;;) {
            skipSpace();
            if (p_ >= end_ || *p_ != '"') {
                return fail("an object key is missing");
            }
            if (!string(key, sizeof key)) {
                return false;
            }
            size_t add = strlen(key) + (pathLen ? 1 : 0);
            if (pathLen + add + 1 > kPathMax) {
                return fail("a field name path is too long");
            }
            size_t at = pathLen;
            if (pathLen) {
                path_[at++] = '.';
            }
            memcpy(path_ + at, key, strlen(key) + 1);
            skipSpace();
            if (p_ >= end_ || *p_ != ':') {
                return fail("a colon is missing");
            }
            p_++;
            if (!value(depth + 1, at + strlen(key))) {
                return false;
            }
            path_[pathLen] = '\0';
            skipSpace();
            if (p_ < end_ && *p_ == ',') {
                p_++;
                continue;
            }
            if (p_ < end_ && *p_ == '}') {
                p_++;
                return true;
            }
            return fail("an object is not closed");
        }
    }

    bool array(int depth, size_t pathLen) {
        p_++;
        skipSpace();
        if (p_ < end_ && *p_ == ']') {
            p_++;
            return true;
        }
        for (int index = 0;; index++) {
            if (index >= limits_.maxArray) {
                return fail("an array has too many items");
            }
            char suffix[12];
            int n = snprintf(suffix, sizeof suffix, "[%d]", index);
            if (pathLen + (size_t)n + 1 > kPathMax) {
                return fail("a field name path is too long");
            }
            memcpy(path_ + pathLen, suffix, (size_t)n + 1);
            if (!value(depth + 1, pathLen + (size_t)n)) {
                return false;
            }
            path_[pathLen] = '\0';
            skipSpace();
            if (p_ < end_ && *p_ == ',') {
                p_++;
                continue;
            }
            if (p_ < end_ && *p_ == ']') {
                p_++;
                return true;
            }
            return fail("an array is not closed");
        }
    }
};

}  // namespace

JsonResult jsonWalk(const char *text, size_t length, const JsonLimits &limits, JsonSink &sink) {
    if (text == nullptr || length == 0) {
        return JsonResult{false, "the document is empty"};
    }
    if (length > limits.maxBytes) {
        return JsonResult{false, "the document is too large"};
    }
    Walker w(text, length, limits, sink);
    return w.run();
}

}  // namespace melophos
