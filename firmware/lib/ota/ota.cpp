#include "ota.h"

#include <string.h>

#include "monocypher-ed25519.h"
#include "recordpair.h"

namespace melophos {

static_assert(sizeof(crypto_sha512_ctx) <= 256, "Updater::hash_ must hold the SHA-512 context");

bool publicKeyUsable(const uint8_t key[32]) {
    // the 8 points of small order on curve25519 in their compressed encodings
    static const uint8_t bad[][32] = {
        {0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {0xEC, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
         0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F},
        {0xEE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
         0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F},
        {0xED, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
         0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F},
        {0x26, 0xE8, 0x95, 0x8F, 0xC2, 0xB2, 0x27, 0xB0, 0x45, 0xC3, 0xF4, 0x89, 0xF2, 0xEF, 0x98, 0xF0,
         0xD5, 0xDF, 0xAC, 0x05, 0xD3, 0xC6, 0x33, 0x39, 0xB1, 0x38, 0x02, 0x88, 0x6D, 0x53, 0xFC, 0x05},
        {0xC7, 0x17, 0x6A, 0x70, 0x3D, 0x4D, 0xD8, 0x4F, 0xBA, 0x3C, 0x0B, 0x76, 0x0D, 0x10, 0x67, 0x0F,
         0x2A, 0x20, 0x53, 0xFA, 0x2C, 0x39, 0xCC, 0xC6, 0x4E, 0xC7, 0xFD, 0x77, 0x92, 0x46, 0x73, 0x7A},
        {0xC7, 0x17, 0x6A, 0x70, 0x3D, 0x4D, 0xD8, 0x4F, 0xBA, 0x3C, 0x0B, 0x76, 0x0D, 0x10, 0x67, 0x0F,
         0x2A, 0x20, 0x53, 0xFA, 0x2C, 0x39, 0xCC, 0xC6, 0x4E, 0xC7, 0xFD, 0x77, 0x92, 0x46, 0x73, 0xFA},
        {0x26, 0xE8, 0x95, 0x8F, 0xC2, 0xB2, 0x27, 0xB0, 0x45, 0xC3, 0xF4, 0x89, 0xF2, 0xEF, 0x98, 0xF0,
         0xD5, 0xDF, 0xAC, 0x05, 0xD3, 0xC6, 0x33, 0x39, 0xB1, 0x38, 0x02, 0x88, 0x6D, 0x53, 0xFC, 0x85}};
    // the sign bit of the encoding does not change which point it is for these, so compare with it cleared
    uint8_t k[32];
    memcpy(k, key, 32);
    k[31] &= 0x7F;
    for (const auto &b : bad) {
        uint8_t c[32];
        memcpy(c, b, 32);
        c[31] &= 0x7F;
        if (memcmp(k, c, 32) == 0) {
            return false;
        }
    }
    return true;
}

bool signatureSelfTest() {
    // RFC 8032 section 7.1, test 1: an empty message
    static const uint8_t pub[32] = {0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
                                    0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a};
    static const uint8_t sig[64] = {0xe5, 0x56, 0x43, 0x00, 0xc3, 0x60, 0xac, 0x72, 0x90, 0x86, 0xe2, 0xcc, 0x80, 0x6e, 0x82, 0x8a,
                                    0x84, 0x87, 0x7f, 0x1e, 0xb8, 0xe5, 0xd9, 0x74, 0xd8, 0x73, 0xe0, 0x65, 0x22, 0x49, 0x01, 0x55,
                                    0x5f, 0xb8, 0x82, 0x15, 0x90, 0xa3, 0x3b, 0xac, 0xc6, 0x1e, 0x39, 0x70, 0x1c, 0xf9, 0xb4, 0x6b,
                                    0xd2, 0x5b, 0xf5, 0xf0, 0x59, 0x5b, 0xbe, 0x24, 0x65, 0x51, 0x41, 0x43, 0x8e, 0x7a, 0x10, 0x0b};
    uint8_t bad[64];
    memcpy(bad, sig, 64);
    bad[10] ^= 1;
    return crypto_ed25519_check(sig, pub, nullptr, 0) == 0 && crypto_ed25519_check(bad, pub, nullptr, 0) != 0;
}

const char *updateErrorText(UpdateError e) {
    switch (e) {
        case UpdateError::None:
            return "ok";
        case UpdateError::Busy:
            return "an update is already running";
        case UpdateError::BadManifest:
            return "the update description is malformed";
        case UpdateError::WrongBoard:
            return "this update is for a different board";
        case UpdateError::BadSignature:
            return "the update is not signed by us";
        case UpdateError::BadKey:
            return "the update key built into this firmware is not a real key, so updates are refused";
        case UpdateError::NotNewer:
            return "the update is not newer than what is installed";
        case UpdateError::KnownBad:
            return "this version already failed on this hub";
        case UpdateError::TooLarge:
            return "the update does not fit in the update slot";
        case UpdateError::Empty:
            return "the update is empty";
        case UpdateError::Overflow:
            return "the update is larger than it said";
        case UpdateError::Truncated:
            return "the update ended early";
        case UpdateError::HashMismatch:
            return "the update does not match its signed checksum";
        case UpdateError::WriteFailed:
            return "writing the update to flash failed";
        case UpdateError::CommitFailed:
            return "the new firmware could not be selected";
        case UpdateError::FetchFailed:
            return "the update could not be downloaded";
        case UpdateError::BadUrl:
        default:
            return "the update address must start with https://";
    }
}

static uint32_t rd32(const uint8_t *p) {
    return p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

UpdateError verifyManifest(const uint8_t *b, size_t length, const uint8_t publicKey[32], uint8_t board, Manifest &out) {
    if (b == nullptr || length != kManifestBytes) {
        return UpdateError::BadManifest;
    }
    if (!publicKeyUsable(publicKey)) {
        return UpdateError::BadKey;
    }
    // the signature first: nothing in an unsigned manifest is read as meaningful
    if (crypto_ed25519_check(b + kSignedBytes, publicKey, b, kSignedBytes) != 0) {
        return UpdateError::BadSignature;
    }
    if (memcmp(b, "MLPH", 4) != 0 || b[4] != 1 || b[6] != 0 || b[7] != 0) {
        return UpdateError::BadManifest;
    }
    if (b[5] != board) {
        return UpdateError::WrongBoard;
    }
    out.board = b[5];
    out.version = rd32(b + 8);
    out.size = rd32(b + 12);
    memcpy(out.sha512, b + 16, 64);
    return UpdateError::None;
}

// ---------- updater ----------

UpdateError Updater::fail(UpdateError e) {
    slot_.abort();
    state_ = State::Failed;
    return e;
}

UpdateError Updater::start(const uint8_t *manifest, size_t length, uint32_t running, uint32_t floor, uint32_t knownBad) {
    if (state_ == State::Receiving) {
        return UpdateError::Busy;
    }
    state_ = State::Idle;
    received_ = 0;
    Manifest m;
    UpdateError e = verifyManifest(manifest, length, key_, board_, m);
    if (e != UpdateError::None) {
        return e;
    }
    if (m.version <= running || m.version <= floor) {
        return UpdateError::NotNewer;
    }
    if (knownBad != 0 && m.version == knownBad) {
        return UpdateError::KnownBad;
    }
    if (m.size == 0) {
        return UpdateError::Empty;
    }
    if (m.size > slot_.capacity()) {
        return UpdateError::TooLarge;
    }
    if (!slot_.begin(m.size)) {
        return UpdateError::WriteFailed;
    }
    manifest_ = m;
    crypto_sha512_init(reinterpret_cast<crypto_sha512_ctx *>(hash_));
    state_ = State::Receiving;
    return UpdateError::None;
}

UpdateError Updater::feed(const uint8_t *data, size_t length) {
    if (state_ != State::Receiving) {
        return UpdateError::Busy;
    }
    if (length > manifest_.size - received_) {
        return fail(UpdateError::Overflow);  // more than signed: stop before writing any of it
    }
    if (!slot_.write(data, length)) {
        return fail(UpdateError::WriteFailed);
    }
    crypto_sha512_update(reinterpret_cast<crypto_sha512_ctx *>(hash_), data, length);
    received_ += (uint32_t)length;
    return UpdateError::None;
}

UpdateError Updater::finish() {
    if (state_ != State::Receiving) {
        return UpdateError::Busy;
    }
    if (received_ != manifest_.size) {
        return fail(UpdateError::Truncated);
    }
    uint8_t digest[64];
    crypto_sha512_final(reinterpret_cast<crypto_sha512_ctx *>(hash_), digest);
    // constant time: the compare must not leak how many bytes matched
    uint8_t diff = 0;
    for (int i = 0; i < 64; i++) {
        diff |= (uint8_t)(digest[i] ^ manifest_.sha512[i]);
    }
    if (diff != 0) {
        return fail(UpdateError::HashMismatch);
    }
    if (!slot_.commit()) {
        return fail(UpdateError::CommitFailed);
    }
    state_ = State::Staged;
    return UpdateError::None;
}

void Updater::cancel() {
    if (state_ == State::Receiving) {
        slot_.abort();
    }
    state_ = State::Idle;
}

bool isHttpsUrl(const char *url) {
    if (url == nullptr || strncmp(url, "https://", 8) != 0) {
        return false;
    }
    const char *host = url + 8;
    size_t n = strlen(host);
    if (n == 0 || host[0] == '/' || host[0] == '?' || host[0] == '#') {
        return false;
    }
    for (const char *p = host; *p && *p != '/' && *p != '?' && *p != '#'; p++) {
        if (*p == '@') {
            return false;  // credentials in the address or a host that is not the one it looks like
        }
    }
    for (const char *p = url; *p; p++) {
        if ((unsigned char)*p <= 0x20 || (unsigned char)*p >= 0x7F) {
            return false;
        }
    }
    return true;
}

namespace {

struct Collect {
    uint8_t bytes[kManifestBytes + 1];
    size_t length;
};
bool onManifestData(void *ctx, const uint8_t *d, size_t n) {
    Collect *c = static_cast<Collect *>(ctx);
    if (n > sizeof c->bytes - c->length) {
        return false;  // longer than any valid manifest
    }
    memcpy(c->bytes + c->length, d, n);
    c->length += n;
    return true;
}
struct Stream {
    Updater *updater;
    UpdateError error;
};
bool onImageData(void *ctx, const uint8_t *d, size_t n) {
    Stream *s = static_cast<Stream *>(ctx);
    s->error = s->updater->feed(d, n);
    return s->error == UpdateError::None;
}

}  // namespace

UpdateError runUpdate(Updater &u, Fetcher &f, const char *manifestUrl, const char *imageUrl, uint32_t running, uint32_t floor,
                      uint32_t knownBad) {
    if (!isHttpsUrl(manifestUrl) || !isHttpsUrl(imageUrl)) {
        return UpdateError::BadUrl;
    }
    Collect manifest{{0}, 0};
    if (!f.get(manifestUrl, sizeof manifest.bytes, onManifestData, &manifest)) {
        return UpdateError::FetchFailed;
    }
    UpdateError e = u.start(manifest.bytes, manifest.length, running, floor, knownBad);
    if (e != UpdateError::None) {
        return e;
    }
    Stream stream{&u, UpdateError::None};
    if (!f.get(imageUrl, u.total(), onImageData, &stream)) {
        UpdateError cause = stream.error != UpdateError::None ? stream.error : UpdateError::FetchFailed;
        u.cancel();
        return cause;
    }
    return u.finish();
}

// ---------- trial and rollback ----------

namespace {
const uint32_t kTrialMagic = 0x4C525454;  // "TTRL"
const uint32_t kFloorMagic = 0x524F4C46;  // "FLOR"
}  // namespace

BootGuard::BootGuard(FirmwareSlot &slot, Flash &flash, uint32_t sectorBase, uint32_t runningVersion)
    : slot_(slot), flash_(flash), base_(sectorBase), running_(runningVersion) {}

uint32_t BootGuard::floor() {
    DurableCounter c(flash_, base_ + 2, base_ + 3, kFloorMagic);
    return c.value();
}

void BootGuard::load() {
    RecordPair pair(flash_, base_, base_ + 1, kTrialMagic);
    uint8_t b[10];
    size_t len;
    rec_ = TrialRecord{0, 0, 0, 0};
    if (pair.load(b, sizeof b, len) && len == 10) {
        rec_.phase = b[0];
        rec_.boots = b[1];
        rec_.targetVersion = b[2] | ((uint32_t)b[3] << 8) | ((uint32_t)b[4] << 16) | ((uint32_t)b[5] << 24);
        rec_.knownBad = b[6] | ((uint32_t)b[7] << 8) | ((uint32_t)b[8] << 16) | ((uint32_t)b[9] << 24);
        if (rec_.phase > 1) {
            rec_ = TrialRecord{0, 0, 0, 0};
        }
    }
}

bool BootGuard::save() {
    RecordPair pair(flash_, base_, base_ + 1, kTrialMagic);
    uint8_t b[10] = {rec_.phase,
                     rec_.boots,
                     (uint8_t)rec_.targetVersion,
                     (uint8_t)(rec_.targetVersion >> 8),
                     (uint8_t)(rec_.targetVersion >> 16),
                     (uint8_t)(rec_.targetVersion >> 24),
                     (uint8_t)rec_.knownBad,
                     (uint8_t)(rec_.knownBad >> 8),
                     (uint8_t)(rec_.knownBad >> 16),
                     (uint8_t)(rec_.knownBad >> 24)};
    return pair.store(b, sizeof b);
}

void BootGuard::rollBack() {
    rolledBack_ = true;
    rec_.knownBad = rec_.targetVersion > rec_.knownBad ? rec_.targetVersion : rec_.knownBad;
    rec_.phase = 0;
    rec_.boots = 0;
    save();
    slot_.rollback();
}

bool BootGuard::onBoot() {
    load();
    healthyNow_ = false;
    if (rec_.phase != 1) {
        return false;
    }
    if (running_ != rec_.targetVersion) {
        // the old image is running, so the new one did not survive its trial (the
        // bootloader reverted it): remember the version so it is not offered again
        if (rec_.targetVersion > rec_.knownBad) {
            rec_.knownBad = rec_.targetVersion;
        }
        rec_.phase = 0;
        save();
        rolledBack_ = true;
        return false;
    }
    rec_.boots++;
    if (rec_.boots > kMaxBoots) {
        rollBack();  // restarted over and over without ever settling
        return false;
    }
    save();
    return true;
}

bool BootGuard::beginTrial(uint32_t targetVersion) {
    rec_.phase = 1;
    rec_.boots = 0;
    rec_.targetVersion = targetVersion;
    return save();
}

void BootGuard::tick(uint32_t uptimeMs, bool healthy) {
    if (rec_.phase != 1 || running_ != rec_.targetVersion) {
        return;
    }
    if (uptimeMs > kTrialMaxMs) {
        rollBack();
        return;
    }
    if (!healthy) {
        healthyNow_ = false;
        return;
    }
    if (!healthyNow_) {
        healthyNow_ = true;
        healthySince_ = uptimeMs;
    }
    if (uptimeMs - healthySince_ >= kHealthyMs) {
        // order matters: raise the floor first. A cut after that point leaves
        // the trial open, the next boot confirms again and nothing is lost
        DurableCounter c(flash_, base_ + 2, base_ + 3, kFloorMagic);
        if (!c.raiseTo(rec_.targetVersion) || !slot_.markValid()) {
            return;
        }
        rec_.phase = 0;
        rec_.boots = 0;
        save();
    }
}

}  // namespace melophos
