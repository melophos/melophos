#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"

namespace melophos {

// Wi-Fi updates, the part that can be proved without a board: the signed
// manifest, the streaming check of the image and the trial-and-rollback state
// machine. The radio, TLS and the flash slot sit behind seams.
//
// Trust chain, every link must hold:
//   1. the manifest is fetched over HTTPS with the server's certificate verified
//   2. its Ed25519 signature checks against the public key compiled into the firmware
//   3. the version is inside the signed bytes and must beat both the running
//      version and the stored floor, so an old signed image cannot be replayed
//   4. the image is hashed (SHA-512) as it streams and must match the signed
//      hash and the signed size exactly before the slot is committed
//   5. the new image boots on trial and is confirmed only after it has run
//      healthy for 60 s. A crash, a reboot loop or a silent hang rolls back.
//
// Signed manifest, 144 bytes, little endian:
//    0  "MLPH"
//    4  format version (1)
//    5  board (1 esp32-s3, 2 esp32-bringup)
//    6  reserved, zero
//    8  version, an integer that rises with every release
//   12  image size in bytes
//   16  SHA-512 of the image
//   80  Ed25519 signature over bytes 0 to 79
const size_t kManifestBytes = 144;
const size_t kSignedBytes = 80;
const uint8_t kBoardS3 = 1;
const uint8_t kBoardBringup = 2;

enum class UpdateError : uint8_t {
    None,
    Busy,          // an update is already running
    BadManifest,   // wrong length, magic, format or reserved bytes
    WrongBoard,    // signed for another board
    BadSignature,  // not signed by our key or altered after signing
    BadKey,        // the key built into the firmware cannot be a real one
    NotNewer,      // version not above the running version and the stored floor
    KnownBad,      // this exact version already failed on this hub
    TooLarge,      // does not fit the slot
    Empty,
    Overflow,      // more image bytes than the manifest promised
    Truncated,     // fewer image bytes than the manifest promised
    HashMismatch,
    WriteFailed,
    CommitFailed,
    FetchFailed,   // network error or time-out
    BadUrl         // not https
};
const char *updateErrorText(UpdateError e);

struct Manifest {
    uint8_t board;
    uint32_t version;
    uint32_t size;
    uint8_t sha512[64];
};

// checks everything about a manifest that needs no image. The public key is a
// parameter so tests can use a key made at test time.
// false for a key that cannot be ours: all zero (the placeholder) and the small-order points,
// which let a signature be forged without the private key
bool publicKeyUsable(const uint8_t key[32]);

// A known-answer check of the signature code against the RFC 8032 test vector 1. The hub runs it
// at start. If it fails, updates stay off
bool signatureSelfTest();

UpdateError verifyManifest(const uint8_t *bytes, size_t length, const uint8_t publicKey[32], uint8_t board, Manifest &out);

// the inactive app slot. The real one is the ESP-IDF OTA API.
class FirmwareSlot {
   public:
    virtual ~FirmwareSlot() {}
    virtual size_t capacity() const = 0;
    virtual bool begin(size_t size) = 0;
    virtual bool write(const uint8_t *data, size_t length) = 0;
    // makes the new image the next boot, on trial
    virtual bool commit() = 0;
    // throws away a half-written image. The running slot is never touched
    virtual void abort() = 0;
    // the running image has proved itself: cancel the rollback
    virtual bool markValid() = 0;
    // run the old image again (the real one reboots)
    virtual void rollback() = 0;
};

class Updater {
   public:
    enum class State : uint8_t { Idle, Receiving, Staged, Failed };

    Updater(FirmwareSlot &slot, const uint8_t publicKey[32], uint8_t board) : slot_(slot), board_(board) {
        for (int i = 0; i < 32; i++) {
            key_[i] = publicKey[i];
        }
    }
    // floor: the highest version ever confirmed on this hub. knownBad: a version that already failed here, 0 for none
    UpdateError start(const uint8_t *manifest, size_t length, uint32_t runningVersion, uint32_t floor, uint32_t knownBad);
    UpdateError feed(const uint8_t *data, size_t length);
    // true only after size, hash and commit all succeeded
    UpdateError finish();
    // drop whatever is in progress
    void cancel();
    State state() const { return state_; }
    uint32_t received() const { return received_; }
    uint32_t total() const { return manifest_.size; }
    uint32_t version() const { return manifest_.version; }

   private:
    FirmwareSlot &slot_;
    uint8_t key_[32];
    uint8_t board_;
    State state_ = State::Idle;
    Manifest manifest_{};
    uint32_t received_ = 0;
    alignas(8) uint8_t hash_[256];  // holds the SHA-512 context, sized in ota.cpp
    UpdateError fail(UpdateError e);
};

// where an update comes from. The real one is HTTPS with the certificate
// chain verified and a time-out on every read. Chunks are handed over as they
// arrive so the image is never held in RAM.
class Fetcher {
   public:
    virtual ~Fetcher() {}
    // streams the body of a GET to onData. false on any error or time-out
    virtual bool get(const char *url, size_t maxBytes, bool (*onData)(void *, const uint8_t *, size_t), void *context) = 0;
};

// only https:// and no user:password@ in front of the host
bool isHttpsUrl(const char *url);

// fetches, checks and stages an update. Never returns success unless every
// link in the chain held.
UpdateError runUpdate(Updater &updater, Fetcher &fetcher, const char *manifestUrl, const char *imageUrl,
                      uint32_t runningVersion, uint32_t floor, uint32_t knownBad);

// ----- trial and rollback -----

struct TrialRecord {
    uint8_t phase;          // 0 idle, 1 trial
    uint8_t boots;          // boots since the trial began
    uint32_t targetVersion;
    uint32_t knownBad;      // highest version that failed its trial
};

// survives power cuts. Rules:
//   a trial lasts at most 10 minutes of uptime and 3 boots
//   healthy for 60 s in a row confirms: the slot is marked valid and the
//   version floor rises to the new version
//   anything else rolls back and remembers the version as known bad
class BootGuard {
   public:
    static const uint32_t kHealthyMs = 60000;
    static const uint32_t kTrialMaxMs = 600000;
    static const uint8_t kMaxBoots = 3;

    BootGuard(FirmwareSlot &slot, Flash &flash, uint32_t sectorBase, uint32_t runningVersion);
    // first thing in setup(). true when this boot is a trial
    bool onBoot();
    // after the updater staged an image
    bool beginTrial(uint32_t targetVersion);
    // every loop pass. healthy is the caller's verdict that this pass is good
    void tick(uint32_t uptimeMs, bool healthy);
    bool inTrial() const { return rec_.phase == 1; }
    uint32_t knownBad() const { return rec_.knownBad; }
    uint32_t floor();
    bool rolledBack() const { return rolledBack_; }

   private:
    FirmwareSlot &slot_;
    Flash &flash_;
    uint32_t base_;
    uint32_t running_;
    TrialRecord rec_{0, 0, 0, 0};
    bool rolledBack_ = false;
    uint32_t healthySince_ = 0;
    bool healthyNow_ = false;
    bool save();
    void load();
    void rollBack();
};

}  // namespace melophos
