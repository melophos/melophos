#include "tlscheck.h"

namespace melophos {

namespace {

bool validDate(const CertTime &t) {
    if (t.year < 1970 || t.year > 9999 || t.month < 1 || t.month > 12 || t.day < 1 || t.hour < 0 || t.hour > 23 ||
        t.minute < 0 || t.minute > 59 || t.second < 0 || t.second > 60) {
        return false;
    }
    static const int days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    bool leap = (t.year % 4 == 0 && t.year % 100 != 0) || t.year % 400 == 0;
    int max = days[t.month - 1] + (t.month == 2 && leap ? 1 : 0);
    return t.day <= max;
}

}  // namespace

int64_t certEpoch(const CertTime &t) {
    if (!validDate(t)) {
        return -1;
    }
    // days from civil, after Howard Hinnant
    int64_t y = t.year - (t.month <= 2 ? 1 : 0);
    int64_t era = (y >= 0 ? y : y - 399) / 400;
    int64_t yoe = y - era * 400;
    int64_t mp = t.month > 2 ? t.month - 3 : t.month + 9;
    int64_t doy = (153 * mp + 2) / 5 + t.day - 1;
    int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    int64_t days = era * 146097 + doe - 719468;
    return days * 86400 + t.hour * 3600 + t.minute * 60 + t.second;
}

CertCheck checkValidity(const CertValidity &v, int64_t now) {
    int64_t from = certEpoch(v.notBefore);
    int64_t to = certEpoch(v.notAfter);
    if (from < 0 || to < 0 || to < from) {
        return CertCheck::Malformed;
    }
    if (now <= 0) {
        return CertCheck::NoClock;
    }
    if (now < from) {
        return CertCheck::NotYetValid;
    }
    if (now > to) {
        return CertCheck::Expired;
    }
    return CertCheck::Ok;
}

CertCheck checkChain(const CertValidity *chain, size_t count, int64_t now) {
    if (chain == nullptr || count == 0 || count > kMaxChain) {
        return CertCheck::Malformed;
    }
    for (size_t i = 0; i < count; i++) {
        CertCheck c = checkValidity(chain[i], now);
        if (c != CertCheck::Ok) {
            return c;
        }
    }
    return CertCheck::Ok;
}

const char *certCheckText(CertCheck c) {
    switch (c) {
        case CertCheck::Ok:
            return "ok";
        case CertCheck::NoClock:
            return "the clock is not set yet, so the broker's certificate cannot be judged";
        case CertCheck::NotYetValid:
            return "the broker's certificate is not valid yet";
        case CertCheck::Expired:
            return "the broker's certificate has expired";
        default:
            return "the broker's certificate dates are malformed";
    }
}

}  // namespace melophos
