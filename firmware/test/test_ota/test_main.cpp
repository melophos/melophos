#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include <random>
#include <vector>

#include "../support/fakes.h"
#include "monocypher-ed25519.h"
#include "ota.h"
#include "profilestore.h"

using namespace melophos;

// the signing key is made here, at test time, from the system's entropy. It is
// never written anywhere and no key of ours exists in this repository
struct Keys {
    uint8_t secret[64];
    uint8_t pub[32];
    Keys() {
        std::random_device rd;
        uint8_t seed[32];
        for (auto &b : seed) {
            b = (uint8_t)rd();
        }
        crypto_ed25519_key_pair(secret, pub, seed);
    }
};
static Keys *keys;
static Keys *otherKeys;

void setUp() {}
void tearDown() {}

static void put32(uint8_t *d, uint32_t v) {
    d[0] = (uint8_t)v;
    d[1] = (uint8_t)(v >> 8);
    d[2] = (uint8_t)(v >> 16);
    d[3] = (uint8_t)(v >> 24);
}

static std::vector<uint8_t> makeImage(size_t n, uint8_t seed = 1) {
    std::vector<uint8_t> v(n);
    for (size_t i = 0; i < n; i++) {
        v[i] = (uint8_t)(i * 31 + seed);
    }
    return v;
}

static std::vector<uint8_t> makeManifest(const std::vector<uint8_t> &image, uint32_t version, uint8_t board = kBoardS3,
                                         const Keys *k = nullptr, uint8_t format = 1, uint8_t reserved = 0,
                                         const char *magic = "MLPH", int64_t sizeOverride = -1) {
    if (!k) {
        k = keys;
    }
    std::vector<uint8_t> m(kManifestBytes, 0);
    memcpy(m.data(), magic, 4);
    m[4] = format;
    m[5] = board;
    m[6] = reserved;
    put32(&m[8], version);
    put32(&m[12], sizeOverride >= 0 ? (uint32_t)sizeOverride : (uint32_t)image.size());
    crypto_sha512(&m[16], image.data(), image.size());
    crypto_ed25519_sign(&m[kSignedBytes], k->secret, m.data(), kSignedBytes);
    return m;
}

struct Rig {
    FakeSlot slot;
    Updater updater{slot, keys->pub, kBoardS3};
};

static UpdateError run(Rig &r, const std::vector<uint8_t> &manifest, const std::vector<uint8_t> &image, uint32_t running = 1,
                       uint32_t floor = 0, uint32_t bad = 0, size_t chunk = 97) {
    UpdateError e = r.updater.start(manifest.data(), manifest.size(), running, floor, bad);
    if (e != UpdateError::None) {
        return e;
    }
    for (size_t i = 0; i < image.size(); i += chunk) {
        e = r.updater.feed(image.data() + i, std::min(chunk, image.size() - i));
        if (e != UpdateError::None) {
            return e;
        }
    }
    return r.updater.finish();
}

void test_a_good_signed_update_is_staged() {
    Rig r;
    auto img = makeImage(3000);
    TEST_ASSERT_EQUAL(UpdateError::None, run(r, makeManifest(img, 2), img));
    TEST_ASSERT_TRUE(r.updater.state() == Updater::State::Staged);
    TEST_ASSERT_EQUAL(1, r.slot.commits);
    TEST_ASSERT_TRUE(r.slot.image == img);
    TEST_ASSERT_EQUAL(0, r.slot.valids);  // nothing is confirmed by staging
}

void test_every_single_byte_change_in_the_manifest_is_refused() {
    auto img = makeImage(500);
    auto good = makeManifest(img, 2);
    for (size_t i = 0; i < good.size(); i++) {
        for (int bit = 0; bit < 8; bit += 7) {  // the lowest and highest bit of each byte
            auto bad = good;
            bad[i] ^= (uint8_t)(1u << bit);
            Rig r;
            UpdateError e = r.updater.start(bad.data(), bad.size(), 1, 0, 0);
            TEST_ASSERT_TRUE_MESSAGE(e != UpdateError::None, "an altered manifest was accepted");
            TEST_ASSERT_EQUAL(0, r.slot.begins);
        }
    }
}

void test_manifest_length_and_nulls() {
    Rig r;
    auto img = makeImage(100);
    auto m = makeManifest(img, 2);
    for (size_t n : {(size_t)0, (size_t)1, (size_t)143, (size_t)145, (size_t)1000}) {
        std::vector<uint8_t> x(n, 0);
        if (n > 0) {  // an empty vector has no data pointer. memcpy with a null one is undefined even for zero bytes
            memcpy(x.data(), m.data(), std::min(n, m.size()));
        }
        TEST_ASSERT_EQUAL(UpdateError::BadManifest, r.updater.start(x.data(), x.size(), 1, 0, 0));
    }
    TEST_ASSERT_EQUAL(UpdateError::BadManifest, r.updater.start(nullptr, 144, 1, 0, 0));
}

void test_a_manifest_signed_by_another_key_is_refused() {
    Rig r;
    auto img = makeImage(100);
    TEST_ASSERT_EQUAL(UpdateError::BadSignature, run(r, makeManifest(img, 2, kBoardS3, otherKeys), img));
    TEST_ASSERT_EQUAL(0, r.slot.begins);
}

void test_properly_signed_but_malformed_manifests_are_refused() {
    Rig r;
    auto img = makeImage(100);
    TEST_ASSERT_EQUAL(UpdateError::WrongBoard, run(r, makeManifest(img, 2, kBoardBringup), img));
    TEST_ASSERT_EQUAL(UpdateError::BadManifest, run(r, makeManifest(img, 2, kBoardS3, nullptr, 2), img));
    TEST_ASSERT_EQUAL(UpdateError::BadManifest, run(r, makeManifest(img, 2, kBoardS3, nullptr, 1, 7), img));
    TEST_ASSERT_EQUAL(UpdateError::BadManifest, run(r, makeManifest(img, 2, kBoardS3, nullptr, 1, 0, "XXXX"), img));
    TEST_ASSERT_EQUAL(UpdateError::Empty, run(r, makeManifest(std::vector<uint8_t>(), 2), std::vector<uint8_t>()));
    TEST_ASSERT_EQUAL(UpdateError::TooLarge, run(r, makeManifest(img, 2, kBoardS3, nullptr, 1, 0, "MLPH", 1 << 20), img));
    TEST_ASSERT_EQUAL(0, r.slot.begins);
}

// the version is inside the signed bytes, so an old release cannot come back
void test_replaying_an_old_signed_image_is_refused() {
    auto img = makeImage(200);
    Rig r;
    auto v2 = makeManifest(img, 2);
    TEST_ASSERT_EQUAL(UpdateError::NotNewer, run(r, v2, img, /*running*/ 2, 0));  // the same version
    TEST_ASSERT_EQUAL(UpdateError::NotNewer, run(r, v2, img, /*running*/ 5, 0));  // older than running
    TEST_ASSERT_EQUAL(UpdateError::NotNewer, run(r, v2, img, /*running*/ 1, /*floor*/ 2));  // at the stored floor
    TEST_ASSERT_EQUAL(UpdateError::NotNewer, run(r, v2, img, 1, 9));                         // below the floor
    TEST_ASSERT_EQUAL(UpdateError::None, run(r, v2, img, 1, 1));
    // an attacker who relabels the version cannot: it is covered by the signature
    auto relabelled = v2;
    put32(&relabelled[8], 99);
    Rig r2;
    TEST_ASSERT_EQUAL(UpdateError::BadSignature, run(r2, relabelled, img));
}

void test_a_version_that_failed_its_trial_is_not_offered_again() {
    auto img = makeImage(200);
    Rig r;
    TEST_ASSERT_EQUAL(UpdateError::KnownBad, run(r, makeManifest(img, 7), img, 1, 0, 7));
    Rig r2;
    TEST_ASSERT_EQUAL(UpdateError::None, run(r2, makeManifest(img, 8), img, 1, 0, 7));
}

void test_a_swapped_or_damaged_image_is_refused_and_never_committed() {
    auto img = makeImage(1000);
    auto m = makeManifest(img, 2);
    {
        Rig r;
        auto bad = img;
        bad[999] ^= 1;  // the last byte only
        TEST_ASSERT_EQUAL(UpdateError::HashMismatch, run(r, m, bad));
        TEST_ASSERT_EQUAL(0, r.slot.commits);
        TEST_ASSERT_EQUAL(1, r.slot.aborts);
        TEST_ASSERT_TRUE(r.updater.state() == Updater::State::Failed);
    }
    {
        Rig r;  // a different image of the right length, as an attacker with the signed manifest would try
        TEST_ASSERT_EQUAL(UpdateError::HashMismatch, run(r, m, makeImage(1000, 9)));
        TEST_ASSERT_EQUAL(0, r.slot.commits);
    }
    {
        Rig r;  // ends early
        TEST_ASSERT_EQUAL(UpdateError::Truncated, run(r, m, std::vector<uint8_t>(img.begin(), img.end() - 1)));
        TEST_ASSERT_EQUAL(0, r.slot.commits);
        TEST_ASSERT_EQUAL(1, r.slot.aborts);
    }
    {
        Rig r;  // longer than signed: refused before the extra byte reaches flash
        auto longer = img;
        longer.push_back(0);
        TEST_ASSERT_EQUAL(UpdateError::Overflow, run(r, m, longer, 1, 0, 0, 1000));
        TEST_ASSERT_EQUAL(0, r.slot.commits);
        TEST_ASSERT_TRUE(r.slot.image.size() <= 1000);
    }
}

void test_flash_errors_abort_the_slot() {
    auto img = makeImage(1000);
    auto m = makeManifest(img, 2);
    {
        Rig r;
        r.slot.failWriteAfter = 500;
        TEST_ASSERT_EQUAL(UpdateError::WriteFailed, run(r, m, img));
        TEST_ASSERT_EQUAL(1, r.slot.aborts);
        TEST_ASSERT_EQUAL(0, r.slot.commits);
    }
    {
        Rig r;
        r.slot.failBegin = true;
        TEST_ASSERT_EQUAL(UpdateError::WriteFailed, run(r, m, img));
    }
    {
        Rig r;
        r.slot.failCommit = true;
        TEST_ASSERT_EQUAL(UpdateError::CommitFailed, run(r, m, img));
        TEST_ASSERT_TRUE(r.updater.state() == Updater::State::Failed);
    }
}

void test_calls_out_of_order_are_refused() {
    Rig r;
    uint8_t b = 0;
    TEST_ASSERT_EQUAL(UpdateError::Busy, r.updater.feed(&b, 1));
    TEST_ASSERT_EQUAL(UpdateError::Busy, r.updater.finish());
    auto img = makeImage(100);
    auto m = makeManifest(img, 2);
    TEST_ASSERT_EQUAL(UpdateError::None, r.updater.start(m.data(), m.size(), 1, 0, 0));
    TEST_ASSERT_EQUAL(UpdateError::Busy, r.updater.start(m.data(), m.size(), 1, 0, 0));
    r.updater.cancel();
    TEST_ASSERT_EQUAL(1, r.slot.aborts);
}

// ----- the key and the self-test -----

void test_keys_that_cannot_be_ours_are_refused_and_the_signature_code_passes_its_known_answer() {
    TEST_ASSERT_TRUE(signatureSelfTest());  // RFC 8032 test vector 1 and a one bit change must fail
    TEST_ASSERT_TRUE(publicKeyUsable(keys->pub));
    uint8_t zero[32] = {0};
    TEST_ASSERT_FALSE(publicKeyUsable(zero));
    uint8_t one[32] = {1};
    TEST_ASSERT_FALSE(publicKeyUsable(one));  // the neutral point
    uint8_t order2[32] = {0xEC, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                          0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F};
    TEST_ASSERT_FALSE(publicKeyUsable(order2));
    // an updater built with a bad key refuses even a manifest that verifies against it
    FakeSlot slot;
    Updater u(slot, zero, kBoardS3);
    auto img = makeImage(100);
    auto m = makeManifest(img, 2);
    TEST_ASSERT_EQUAL(UpdateError::BadKey, u.start(m.data(), m.size(), 1, 0, 0));
    TEST_ASSERT_NOT_NULL(strstr(updateErrorText(UpdateError::BadKey), "not a real key"));
}

// ----- the network seam -----

void test_urls_must_be_https_without_credentials() {
    TEST_ASSERT_TRUE(isHttpsUrl("https://updates.example.org/hub/manifest.bin"));
    TEST_ASSERT_TRUE(isHttpsUrl("https://updates.example.org:8443/x?y=1"));
    const char *bad[] = {"http://updates.example.org/x", "https://", "https:///path", "https://user:pw@host/x",
                         "https://host@evil.example/x", "HTTPS://host/x", "ftp://host/x", "", "https://ho st/x",
                         "https://host/\x7f", "https://host/é", "//host/x", "javascript:alert(1)"};
    for (const char *u : bad) {
        TEST_ASSERT_FALSE_MESSAGE(isHttpsUrl(u), u);
    }
    TEST_ASSERT_FALSE(isHttpsUrl(nullptr));
}

void test_run_update_end_to_end_and_each_network_failure() {
    auto img = makeImage(2500);
    auto m = makeManifest(img, 3);
    FakeFetcher f;
    f.manifest.assign(m.begin(), m.end());
    f.image = img;
    {
        Rig r;
        TEST_ASSERT_EQUAL(UpdateError::None, runUpdate(r.updater, f, "https://u.example/manifest", "https://u.example/image", 1, 0, 0));
        TEST_ASSERT_TRUE(r.slot.image == img);
    }
    {
        Rig r;
        TEST_ASSERT_EQUAL(UpdateError::BadUrl, runUpdate(r.updater, f, "http://u.example/manifest", "https://u.example/image", 1, 0, 0));
        TEST_ASSERT_EQUAL(UpdateError::BadUrl, runUpdate(r.updater, f, "https://u.example/manifest", "http://u.example/image", 1, 0, 0));
    }
    {
        Rig r;
        FakeFetcher g = f;
        g.failManifest = true;
        TEST_ASSERT_EQUAL(UpdateError::FetchFailed, runUpdate(r.updater, g, "https://u/manifest", "https://u/image", 1, 0, 0));
        TEST_ASSERT_EQUAL(0, r.slot.begins);
    }
    {
        Rig r;
        FakeFetcher g = f;
        g.failImageAfter = 1200;  // the connection drops part way
        TEST_ASSERT_EQUAL(UpdateError::FetchFailed, runUpdate(r.updater, g, "https://u/manifest", "https://u/image", 1, 0, 0));
        TEST_ASSERT_EQUAL(0, r.slot.commits);
        TEST_ASSERT_EQUAL(1, r.slot.aborts);
        TEST_ASSERT_TRUE(r.updater.state() == Updater::State::Idle);
    }
    {
        Rig r;
        FakeFetcher g = f;
        g.manifest = std::string(5000, 'x');  // an endless manifest is cut at its cap
        TEST_ASSERT_EQUAL(UpdateError::FetchFailed, runUpdate(r.updater, g, "https://u/manifest", "https://u/image", 1, 0, 0));
    }
    {
        Rig r;
        FakeFetcher g = f;
        g.image.push_back(0);
        g.image.insert(g.image.end(), 5000, 7);  // more body than signed
        UpdateError e = runUpdate(r.updater, g, "https://u/manifest", "https://u/image", 1, 0, 0);
        TEST_ASSERT_EQUAL(UpdateError::Overflow, e);
        TEST_ASSERT_EQUAL(0, r.slot.commits);
    }
}

// ----- trial, confirmation and rollback -----

struct GuardRig {
    FakeFlash flash{24};
    FakeSlot slot;
    uint32_t base = 20;
};

void test_a_trial_is_confirmed_only_after_a_minute_of_continuous_health() {
    GuardRig r;
    {
        BootGuard old(r.slot, r.flash, r.base, 1);
        TEST_ASSERT_FALSE(old.onBoot());
        TEST_ASSERT_TRUE(old.beginTrial(2));
    }
    BootGuard g(r.slot, r.flash, r.base, 2);  // the new image has booted
    TEST_ASSERT_TRUE(g.onBoot());
    for (uint32_t t = 1000; t < 1000 + 59000; t += 1000) {
        g.tick(t, true);
    }
    TEST_ASSERT_EQUAL(0, r.slot.valids);
    g.tick(30000, false);  // one bad pass resets the clock
    for (uint32_t t = 31000; t < 31000 + 59000; t += 1000) {
        g.tick(t, true);
    }
    TEST_ASSERT_EQUAL(0, r.slot.valids);
    g.tick(31000 + 59000, true);
    TEST_ASSERT_EQUAL(0, r.slot.valids);
    g.tick(31000 + 60000, true);
    TEST_ASSERT_EQUAL(1, r.slot.valids);
    TEST_ASSERT_FALSE(g.inTrial());
    TEST_ASSERT_EQUAL(2, (int)g.floor());
    BootGuard next(r.slot, r.flash, r.base, 2);  // a later boot: no longer a trial
    TEST_ASSERT_FALSE(next.onBoot());
    TEST_ASSERT_EQUAL(0, r.slot.rollbacks);
}

void test_a_trial_that_never_gets_healthy_rolls_back_and_remembers() {
    GuardRig r;
    BootGuard(r.slot, r.flash, r.base, 1).beginTrial(2);
    BootGuard g(r.slot, r.flash, r.base, 2);
    g.onBoot();
    for (uint32_t t = 1000; t <= BootGuard::kTrialMaxMs; t += 1000) {
        g.tick(t, false);
    }
    TEST_ASSERT_EQUAL(0, r.slot.rollbacks);
    g.tick(BootGuard::kTrialMaxMs + 1, false);
    TEST_ASSERT_EQUAL(1, r.slot.rollbacks);
    TEST_ASSERT_EQUAL(0, r.slot.valids);
    TEST_ASSERT_EQUAL(2, (int)g.knownBad());
    BootGuard after(r.slot, r.flash, r.base, 1);  // the old image comes back
    after.onBoot();
    TEST_ASSERT_EQUAL(2, (int)after.knownBad());
    TEST_ASSERT_EQUAL(0, (int)after.floor());  // the floor never rose: version 1 stays the baseline
}

void test_a_reboot_loop_in_the_trial_rolls_back() {
    GuardRig r;
    BootGuard(r.slot, r.flash, r.base, 1).beginTrial(2);
    int rolled = 0;
    for (int boot = 1; boot <= 6; boot++) {
        BootGuard g(r.slot, r.flash, r.base, 2);  // crashes before it can be confirmed
        g.onBoot();
        if (r.slot.rollbacks > rolled) {
            TEST_ASSERT_EQUAL(BootGuard::kMaxBoots + 1, boot);
            rolled = r.slot.rollbacks;
            break;
        }
    }
    TEST_ASSERT_EQUAL(1, rolled);
}

void test_the_old_image_after_a_bootloader_revert_marks_the_version_bad() {
    GuardRig r;
    BootGuard(r.slot, r.flash, r.base, 1).beginTrial(5);
    BootGuard old(r.slot, r.flash, r.base, 1);  // the new image crashed and the bootloader went back
    TEST_ASSERT_FALSE(old.onBoot());
    TEST_ASSERT_TRUE(old.rolledBack());
    TEST_ASSERT_EQUAL(5, (int)old.knownBad());
    TEST_ASSERT_FALSE(old.inTrial());
}

void test_power_cut_at_every_step_of_confirmation_is_safe() {
    long steps;
    {
        GuardRig r;
        BootGuard(r.slot, r.flash, r.base, 1).beginTrial(2);
        BootGuard g(r.slot, r.flash, r.base, 2);
        g.onBoot();
        g.tick(0, true);
        r.flash.resetCounters();
        g.tick(60000, true);
        steps = r.flash.steps();
    }
    TEST_ASSERT_TRUE(steps > 30);
    for (long cut = 0; cut <= steps; cut++) {
        GuardRig r;
        BootGuard(r.slot, r.flash, r.base, 1).beginTrial(2);
        {
            BootGuard g(r.slot, r.flash, r.base, 2);
            g.onBoot();
            g.tick(0, true);
            r.flash.cutAfter(cut);
            g.tick(60000, true);
            r.flash.restorePower();
        }
        // reboot: whatever the cut left, the machine must still finish cleanly
        BootGuard again(r.slot, r.flash, r.base, 2);
        again.onBoot();
        again.tick(0, true);
        again.tick(60000, true);
        BootGuard last(r.slot, r.flash, r.base, 2);
        TEST_ASSERT_FALSE(last.onBoot());
        TEST_ASSERT_EQUAL(2, (int)last.floor());
        TEST_ASSERT_TRUE(r.slot.valids >= 1);
        TEST_ASSERT_EQUAL(0, r.slot.rollbacks);
    }
}

void test_profiles_and_the_floor_share_a_chip_without_harming_each_other() {
    GuardRig r;
    ProfileStore store(r.flash);
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.begin());
    Profile p = defaultProfile();
    strcpy(p.id, "mine");
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.save(p));
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.setActive("mine"));
    // a whole update, a confirmed one and a rolled back one
    BootGuard(r.slot, r.flash, r.base, 1).beginTrial(2);
    BootGuard g(r.slot, r.flash, r.base, 2);
    g.onBoot();
    g.tick(0, true);
    g.tick(60000, true);
    BootGuard(r.slot, r.flash, r.base, 2).beginTrial(3);
    BootGuard h(r.slot, r.flash, r.base, 3);
    h.onBoot();
    h.tick(BootGuard::kTrialMaxMs + 1, false);
    ProfileStore after(r.flash);
    TEST_ASSERT_EQUAL(ProfileStore::Ok, after.begin());
    TEST_ASSERT_EQUAL(1, after.count());
    TEST_ASSERT_EQUAL_STRING("mine", after.activeOrDefault().id);
    TEST_ASSERT_EQUAL(2, (int)BootGuard(r.slot, r.flash, r.base, 2).floor());
}

// ----- hostile input, random -----

void test_random_manifests_and_mutations_are_never_accepted() {
    std::mt19937 rng(std::random_device{}());
    auto img = makeImage(64);
    auto good = makeManifest(img, 2);
    for (int i = 0; i < 20000; i++) {
        std::vector<uint8_t> m(kManifestBytes);
        if (i % 2) {
            m = good;
            int flips = 1 + (int)(rng() % 4);
            for (int k = 0; k < flips; k++) {
                m[rng() % m.size()] ^= (uint8_t)(1 + rng() % 255);
            }
        } else {
            for (auto &b : m) {
                b = (uint8_t)rng();
            }
        }
        if (m == good) {
            continue;  // two flips of the same byte cancelled out: that is the genuine manifest
        }
        Rig r;
        TEST_ASSERT_TRUE(r.updater.start(m.data(), m.size(), 1, 0, 0) != UpdateError::None);
    }
}

// the Python signing tool and the device must agree. tools/check_signing.sh sets the folder
void test_the_signing_tool_output_verifies_on_the_device_side() {
    const char *dir = getenv("MELOPHOS_SIGN_FIXTURE");
    if (!dir) {
        TEST_IGNORE_MESSAGE("MELOPHOS_SIGN_FIXTURE not set: run tools/check_signing.sh");
    }
    auto readAll = [&](const char *name) {
        std::string path = std::string(dir) + "/" + name;
        FILE *f = fopen(path.c_str(), "rb");
        TEST_ASSERT_NOT_NULL_MESSAGE(f, path.c_str());
        std::vector<uint8_t> v;
        uint8_t buf[4096];
        size_t n;
        while ((n = fread(buf, 1, sizeof buf, f)) > 0) {
            v.insert(v.end(), buf, buf + n);
        }
        fclose(f);
        return v;
    };
    auto pub = readAll("public.key");
    auto manifest = readAll("manifest.bin");
    auto image = readAll("image.bin");
    TEST_ASSERT_EQUAL(32, (int)pub.size());
    FakeSlot slot;
    slot.cap = 1 << 20;
    Updater u(slot, pub.data(), kBoardS3);
    TEST_ASSERT_EQUAL(UpdateError::None, u.start(manifest.data(), manifest.size(), 1, 0, 0));
    TEST_ASSERT_EQUAL(UpdateError::None, u.feed(image.data(), image.size()));
    TEST_ASSERT_EQUAL(UpdateError::None, u.finish());
}

int main() {
    keys = new Keys();
    otherKeys = new Keys();
    UNITY_BEGIN();
    RUN_TEST(test_a_good_signed_update_is_staged);
    RUN_TEST(test_every_single_byte_change_in_the_manifest_is_refused);
    RUN_TEST(test_manifest_length_and_nulls);
    RUN_TEST(test_a_manifest_signed_by_another_key_is_refused);
    RUN_TEST(test_properly_signed_but_malformed_manifests_are_refused);
    RUN_TEST(test_replaying_an_old_signed_image_is_refused);
    RUN_TEST(test_a_version_that_failed_its_trial_is_not_offered_again);
    RUN_TEST(test_a_swapped_or_damaged_image_is_refused_and_never_committed);
    RUN_TEST(test_flash_errors_abort_the_slot);
    RUN_TEST(test_calls_out_of_order_are_refused);
    RUN_TEST(test_keys_that_cannot_be_ours_are_refused_and_the_signature_code_passes_its_known_answer);
    RUN_TEST(test_urls_must_be_https_without_credentials);
    RUN_TEST(test_run_update_end_to_end_and_each_network_failure);
    RUN_TEST(test_a_trial_is_confirmed_only_after_a_minute_of_continuous_health);
    RUN_TEST(test_a_trial_that_never_gets_healthy_rolls_back_and_remembers);
    RUN_TEST(test_a_reboot_loop_in_the_trial_rolls_back);
    RUN_TEST(test_the_old_image_after_a_bootloader_revert_marks_the_version_bad);
    RUN_TEST(test_power_cut_at_every_step_of_confirmation_is_safe);
    RUN_TEST(test_profiles_and_the_floor_share_a_chip_without_harming_each_other);
    RUN_TEST(test_random_manifests_and_mutations_are_never_accepted);
    RUN_TEST(test_the_signing_tool_output_verifies_on_the_device_side);
    return UNITY_END();
}
