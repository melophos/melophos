#pragma once

#include <stddef.h>
#include <stdint.h>

namespace melophos {

// the Arduino ESP32 core this project pins (4.20017.260907) builds mbedTLS with
// CONFIG_MBEDTLS_HAVE_TIME_DATE switched off on both the ESP32-S3 and the
// classic ESP32, so the library checks the chain's signatures and the host
// name but NOT the validity dates. We check them ourselves after the handshake,
// for every certificate the broker presented.
struct CertTime {
    int year, month, day, hour, minute, second;  // as in the certificate, UTC
};

struct CertValidity {
    CertTime notBefore;
    CertTime notAfter;
};

// seconds since 1970 for a UTC date or -1 when the fields are out of range
int64_t certEpoch(const CertTime &t);

enum class CertCheck : uint8_t { Ok, NoClock, NotYetValid, Expired, Malformed };

// now is the hub's wall clock in epoch seconds, 0 while it is not set. With no
// clock the answer is NoClock and the caller must refuse the connection: a
// certificate cannot be judged without the date.
CertCheck checkValidity(const CertValidity &v, int64_t now);

// the whole presented chain: every certificate is dated, the first failure wins. A chain of more than
// kMaxChain certificates is refused outright, not truncated
const size_t kMaxChain = 10;
CertCheck checkChain(const CertValidity *chain, size_t count, int64_t now);

const char *certCheckText(CertCheck c);

}  // namespace melophos
