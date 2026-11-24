#pragma once

#include <stddef.h>
#include <stdint.h>

// the seams between the portable logic in lib/ and the board. Each one has a
// real implementation in src/ and a fake in test/support/, so the same logic
// is exercised on the host and runs on the target.
namespace melophos {

class Clock {
   public:
    virtual ~Clock() {}
    virtual uint32_t nowMs() const = 0;
};

// NOR flash model: erase sets a whole sector to 0xFF, program can only clear
// bits. Every call reports failure so a worn or absent chip is visible.
class Flash {
   public:
    virtual ~Flash() {}
    virtual uint32_t sectorSize() const = 0;
    virtual uint32_t sectorCount() const = 0;
    virtual bool erase(uint32_t sector) = 0;
    virtual bool read(uint32_t address, void *out, size_t length) const = 0;
    virtual bool program(uint32_t address, const void *data, size_t length) = 0;
};

// mutual exclusion between the main loop and the network task. The host tests use
// the do-nothing default.
class Lock {
   public:
    virtual ~Lock() {}
    virtual void lock() {}
    virtual void unlock() {}
};

class LockGuard {
   public:
    explicit LockGuard(Lock &l) : l_(l) { l_.lock(); }
    ~LockGuard() { l_.unlock(); }

   private:
    Lock &l_;
};

struct Rgb {
    uint8_t r, g, b;
};

// the LED strip as a frame of pixels. The real one drives FastLED, the fake
// keeps the last frame and charges the time a real show() would block for.
class LedSink {
   public:
    virtual ~LedSink() {}
    virtual void show(const Rgb *pixels, size_t count) = 0;
    // true when the sink holds something back and needs another show() later even if nothing changes
    virtual bool pending() const { return false; }
    // the content has just gone dark on purpose (a stop, a mode change, the end of a lesson): the next frame's falls
    // need not wait in the fall queue. A sink that has no queue ignores it
    virtual void darkNow() {}
};

// SHA-256 and HMAC-SHA256 (RFC 6234 and RFC 2104). The broker password is the hex of
// HMAC-SHA256(key = the device secret, message = "mqtt")
void sha256(const uint8_t *data, size_t length, uint8_t out[32]);
void hmacSha256(const uint8_t *key, size_t keyLength, const uint8_t *msg, size_t msgLength, uint8_t out[32]);
// 64 lower case hex characters and a terminating NUL
void brokerPassword(const char *deviceSecret, char out[65]);

uint32_t crc32(const void *data, size_t length, uint32_t seed = 0);

// whoever wants the server's clock. The server's answer to GET /api/v1/device carries `server_time` (UTC seconds)
// and it is the trusted time: it is the server's own clock that decides whether a session's date is accepted
struct ServerTimeSink {
    // synced false: the server does not yet trust its own clock (a Raspberry Pi with no clock battery after a
    // power cut), so its time must not be used to correct the hub's
    virtual void onServerTime(int64_t utcSeconds, bool synced) = 0;
};

// a strict unsigned number for a serial argument: digits only, the WHOLE argument, not empty and not above max, all
// checked before anything is cast. "abc", "12abc", "-1", "+5", " 5", "", "65596" for a limit of 150 and any number
// that does not fit in 32 bits ("4294967356" would wrap to 60 in a 32 bit unsigned long) are all refused. The check
// is made BEFORE the multiply by ten could overflow, in the width of Word, so the same code is right on the board
// and on the host. parseUnsigned is the one the firmware uses and it is 32 bits wide on every machine
template <typename Word>
bool parseUnsignedIn(const char *text, Word max, Word &out) {
    if (text == nullptr || text[0] == '\0') {
        return false;
    }
    const Word top = (Word)~(Word)0;
    Word v = 0;
    for (const char *c = text; *c != '\0'; c++) {
        if (*c < '0' || *c > '9') {
            return false;
        }
        Word d = (Word)(*c - '0');
        if (v > (Word)((top - d) / 10)) {
            return false;  // v * 10 + d would not fit in Word
        }
        v = (Word)(v * 10 + d);
    }
    if (v > max) {
        return false;
    }
    out = v;
    return true;
}
bool parseUnsigned(const char *text, uint32_t max, uint32_t &out);

}  // namespace melophos
