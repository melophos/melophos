#pragma once

#include <stddef.h>

namespace melophos {

enum class JsonKind { String, Number, Bool, Null };

// receives every leaf of a document with a flat path such as "leds.layout" or
// "strings[2]". Return false to stop with a clear error.
class JsonSink {
   public:
    virtual ~JsonSink() {}
    virtual bool leaf(const char *path, JsonKind kind, const char *text, double number, bool flag) = 0;
};

struct JsonLimits {
    size_t maxBytes;
    int maxDepth;
    size_t maxString;
    int maxArray;
};

struct JsonResult {
    bool ok;
    char message[80];
};

// A bounded, allocation-free reader for documents that arrive from outside.
// It refuses what it does not understand (string escapes, exponents, nesting
// past the limit) instead of guessing.
JsonResult jsonWalk(const char *text, size_t length, const JsonLimits &limits, JsonSink &sink);

}  // namespace melophos
