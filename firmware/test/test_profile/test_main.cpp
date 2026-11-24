#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>

#include "../support/fakes.h"
#include "profile.h"
#include "profilecmd.h"
#include "profilestore.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static std::string slurp(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        return "";
    }
    std::string s;
    char buf[512];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) {
        s.append(buf, n);
    }
    fclose(f);
    return s;
}

static ProfileResult parseText(const std::string &s, Profile &p) {
    return parseProfile(s.data(), s.size(), p);
}

static const char *kGood =
    "{\"id\":\"mine\",\"name\":\"My keys\",\"type\":\"keyboard\",\"notes\":{\"lowest\":36,\"highest\":96},"
    "\"geometry\":{\"white_key_mm\":23.5},\"leds\":{\"layout\":\"per-key\",\"offset\":0,\"reversed\":false}}";

// every shipped profile must be accepted and map to a sane LED count
void test_shipped_profiles_are_accepted() {
    const char *files[] = {"piano-88", "piano-88-strip-144", "piano-76", "piano-61", "guitar-6-standard"};
    for (const char *name : files) {
        std::string path = std::string("../profiles/") + name + ".json";
        std::string text = slurp(path.c_str());
        TEST_ASSERT_TRUE_MESSAGE(!text.empty(), path.c_str());
        Profile p;
        ProfileResult r = parseText(text, p);
        TEST_ASSERT_TRUE_MESSAGE(r.ok, r.message);
        TEST_ASSERT_EQUAL_STRING(name, p.id);
        TEST_ASSERT_TRUE(profileLedCount(p) <= 180);
    }
}

// the invalid corpus in profiles/invalid is the same set the schema check refuses
void test_invalid_corpus_is_refused_with_a_message() {
    const char *files[] = {"leds-too-many", "note-out-of-range", "unknown-field", "missing-id", "bad-id",
                           "strip-without-density", "offset-negative", "lowest-above-highest",
                           "grid-on-keyboard", "too-many-strings", "frets-zero", "white-key-huge",
                           "type-wrong", "trailing-garbage"};
    for (const char *name : files) {
        std::string path = std::string("../profiles/invalid/") + name + ".json";
        std::string text = slurp(path.c_str());
        TEST_ASSERT_TRUE_MESSAGE(!text.empty(), path.c_str());
        Profile p;
        ProfileResult r = parseText(text, p);
        TEST_ASSERT_FALSE_MESSAGE(r.ok, path.c_str());
        TEST_ASSERT_TRUE_MESSAGE(strlen(r.message) > 8, path.c_str());
    }
}

void test_parse_rounds_values_and_bounds_led_count() {
    Profile p;
    TEST_ASSERT_TRUE(parseText(kGood, p).ok);
    TEST_ASSERT_EQUAL(36, p.lowest);
    TEST_ASSERT_EQUAL(2350, p.whiteKeyCentiMm);
    TEST_ASSERT_EQUAL(61, profileLedCount(p));
    // 128 per-key LEDs plus the largest offset is 160 and fits the strip
    std::string big = kGood;
    big.replace(big.find("\"lowest\":36"), 11, "\"lowest\":0");
    big.replace(big.find("\"highest\":96"), 12, "\"highest\":127");
    big.replace(big.find("\"offset\":0"), 10, "\"offset\":32");
    ProfileResult r = parseText(big, p);
    TEST_ASSERT_TRUE_MESSAGE(r.ok, r.message);
    TEST_ASSERT_EQUAL(160, profileLedCount(p));
    // a strip dense enough to need more than 180 LEDs is refused, naming the limit
    std::string dense = kGood;
    dense.replace(dense.find("\"per-key\""), 9, "\"strip\",\"density_per_m\":300");
    r = parseText(dense, p);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_NOT_NULL(strstr(r.message, "180"));
    // one LED fewer per metre that still needs more than 180 is refused too and 144 per metre is accepted
    dense.replace(dense.find("300"), 3, "144");
    TEST_ASSERT_TRUE(parseText(dense, p).ok);
    TEST_ASSERT_TRUE(profileLedCount(p) <= 180);
}

void test_hostile_documents_never_pass() {
    Profile p;
    std::string deep = "{\"a\":{\"b\":{\"c\":{\"d\":{\"e\":1}}}}}";
    TEST_ASSERT_FALSE(parseText(deep, p).ok);
    TEST_ASSERT_FALSE(parseText(std::string(2000, '{'), p).ok);
    TEST_ASSERT_FALSE(parseText(std::string(5000, ' '), p).ok);
    TEST_ASSERT_FALSE(parseText("", p).ok);
    TEST_ASSERT_FALSE(parseText("null", p).ok);
    TEST_ASSERT_FALSE(parseText("[1,2,3]", p).ok);
    std::string esc = kGood;
    esc.replace(esc.find("My keys"), 7, "My \\u0041 keys");
    TEST_ASSERT_FALSE(parseText(esc, p).ok);
    std::string expo = kGood;
    expo.replace(expo.find("23.5"), 4, "2.35e1");
    TEST_ASSERT_FALSE(parseText(expo, p).ok);
    std::string dup = kGood;
    dup.replace(dup.find("\"name\":\"My keys\""), 16, "\"name\":\"a\",\"name\":\"b\"");
    TEST_ASSERT_FALSE(parseText(dup, p).ok);
    // every truncation of a good document is refused, never accepted or crashed on
    std::string good = kGood;
    for (size_t n = 0; n < good.size(); n++) {
        TEST_ASSERT_FALSE(parseProfile(good.data(), n, p).ok);
    }
}

void test_decode_refuses_a_record_that_passes_its_checksum_but_is_out_of_range() {
    Profile p;
    TEST_ASSERT_TRUE(parseText(kGood, p).ok);
    uint8_t buf[kProfileBytes];
    TEST_ASSERT_EQUAL(kProfileBytes, encodeProfile(p, buf, sizeof buf));
    Profile back;
    TEST_ASSERT_TRUE(decodeProfile(buf, sizeof buf, back));
    TEST_ASSERT_EQUAL_STRING("mine", back.id);
    buf[33 + 65 + 3] = 200;  // highest above 127
    TEST_ASSERT_FALSE(decodeProfile(buf, sizeof buf, back));
    TEST_ASSERT_TRUE(encodeProfile(p, buf, sizeof buf) == kProfileBytes);
    buf[33 + 65 + 8] = 255;  // offset past the limit
    TEST_ASSERT_FALSE(decodeProfile(buf, sizeof buf, back));
}

static Profile make(const char *id, int lowest = 36, int highest = 96) {
    char json[400];
    snprintf(json, sizeof json,
             "{\"id\":\"%s\",\"name\":\"Profile %s\",\"type\":\"keyboard\",\"notes\":{\"lowest\":%d,\"highest\":%d},"
             "\"geometry\":{\"white_key_mm\":23.5},\"leds\":{\"layout\":\"per-key\"}}",
             id, id, lowest, highest);
    Profile p;
    ProfileResult r = parseProfile(json, strlen(json), p);
    TEST_ASSERT_TRUE_MESSAGE(r.ok, r.message);
    return p;
}

void test_store_saves_lists_switches_and_survives_a_restart() {
    FakeFlash flash;
    ProfileStore store(flash);
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.begin());
    TEST_ASSERT_EQUAL(0, store.count());
    TEST_ASSERT_EQUAL_STRING("piano-88", store.activeOrDefault().id);  // built-in default
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.save(make("one")));
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.save(make("two", 21, 108)));
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.setActive("two"));
    ProfileStore again(flash);  // a restart: only flash survives
    TEST_ASSERT_EQUAL(ProfileStore::Ok, again.begin());
    TEST_ASSERT_EQUAL(2, again.count());
    TEST_ASSERT_EQUAL_STRING("two", again.activeOrDefault().id);
    Profile p;
    TEST_ASSERT_EQUAL(ProfileStore::Ok, again.load("one", p));
    TEST_ASSERT_EQUAL(36, p.lowest);
    TEST_ASSERT_EQUAL(ProfileStore::NotFound, again.load("three", p));
    TEST_ASSERT_EQUAL(ProfileStore::NotFound, again.setActive("three"));
}

void test_store_limit_is_eight_profiles_and_a_ninth_is_refused() {
    FakeFlash flash;
    ProfileStore store(flash);
    store.begin();
    for (int i = 0; i < 8; i++) {
        char id[16];
        snprintf(id, sizeof id, "p%d", i);
        TEST_ASSERT_EQUAL(ProfileStore::Ok, store.save(make(id)));
    }
    TEST_ASSERT_EQUAL(ProfileStore::Full, store.save(make("p9")));
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.save(make("p3", 40, 90)));  // updating is not adding
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.remove("p0"));
    TEST_ASSERT_EQUAL(ProfileStore::Ok, store.save(make("p9")));  // room again
    TEST_ASSERT_EQUAL(8, store.count());
}

void test_a_too_small_chip_is_reported() {
    FakeFlash flash(5);
    ProfileStore store(flash);
    TEST_ASSERT_EQUAL(ProfileStore::BadFlash, store.begin());
    TEST_ASSERT_EQUAL(ProfileStore::BadFlash, store.save(make("x")));
}

void test_corrupt_records_are_ignored() {
    FakeFlash flash;
    {
        ProfileStore s(flash);
        s.begin();
        s.save(make("one"));
    }
    flash.raw()[30] ^= 0x01;  // flip a payload bit in sector 0
    ProfileStore s(flash);
    TEST_ASSERT_EQUAL(ProfileStore::Ok, s.begin());
    TEST_ASSERT_EQUAL(0, s.count());
    flash.raw()[0] = 0;  // bad magic everywhere is also just empty
    TEST_ASSERT_EQUAL(ProfileStore::Ok, ProfileStore(flash).begin());
}

// the heart of the acceptance: cut the power at every step of every write
void test_power_cut_at_every_step_leaves_old_or_new() {
    // learn how many steps a replacing save takes
    long saveSteps;
    {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("one", 36, 96));
        flash.resetCounters();
        s.save(make("one", 21, 108));
        saveSteps = flash.steps();
    }
    TEST_ASSERT_TRUE(saveSteps > 100);
    for (long cut = 0; cut <= saveSteps; cut++) {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("one", 36, 96));
        flash.cutAfter(cut);
        s.save(make("one", 21, 108));
        flash.restorePower();
        ProfileStore after(flash);
        TEST_ASSERT_EQUAL(ProfileStore::Ok, after.begin());
        Profile p;
        TEST_ASSERT_EQUAL_MESSAGE(ProfileStore::Ok, after.load("one", p), "profile lost");
        bool oldCopy = p.lowest == 36 && p.highest == 96;
        bool newCopy = p.lowest == 21 && p.highest == 108;
        TEST_ASSERT_TRUE_MESSAGE(oldCopy || newCopy, "torn profile accepted");
        TEST_ASSERT_EQUAL(1, after.count());
        // and the store keeps working after the cut
        TEST_ASSERT_EQUAL(ProfileStore::Ok, after.save(make("one", 40, 80)));
        TEST_ASSERT_EQUAL(ProfileStore::Ok, after.load("one", p));
        TEST_ASSERT_EQUAL(40, p.lowest);
    }
}

void test_power_cut_during_a_first_save_gives_nothing_or_the_whole_profile() {
    long saveSteps;
    {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("one"));
        saveSteps = flash.steps();
    }
    for (long cut = 0; cut <= saveSteps; cut++) {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        flash.cutAfter(cut);
        s.save(make("one"));
        flash.restorePower();
        ProfileStore after(flash);
        after.begin();
        Profile p;
        if (after.load("one", p) == ProfileStore::Ok) {
            TEST_ASSERT_EQUAL(36, p.lowest);
        } else {
            TEST_ASSERT_EQUAL(0, after.count());
        }
    }
}

void test_power_cut_while_switching_keeps_old_or_new_active() {
    long steps;
    {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("a"));
        s.save(make("b"));
        s.setActive("a");
        flash.resetCounters();
        s.setActive("b");
        steps = flash.steps();
    }
    for (long cut = 0; cut <= steps; cut++) {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("a"));
        s.save(make("b"));
        s.setActive("a");
        flash.cutAfter(cut);
        s.setActive("b");
        flash.restorePower();
        ProfileStore after(flash);
        after.begin();
        char id[33];
        TEST_ASSERT_TRUE(after.activeId(id, sizeof id));
        TEST_ASSERT_TRUE(!strcmp(id, "a") || !strcmp(id, "b"));
    }
}

void test_power_cut_while_removing() {
    long steps;
    {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("a"));
        flash.resetCounters();
        s.remove("a");
        steps = flash.steps();
    }
    for (long cut = 0; cut <= steps; cut++) {
        FakeFlash flash;
        ProfileStore s(flash);
        s.begin();
        s.save(make("a"));
        flash.cutAfter(cut);
        s.remove("a");
        flash.restorePower();
        ProfileStore after(flash);
        after.begin();
        TEST_ASSERT_TRUE(after.count() <= 1);
        Profile p;
        if (after.count() == 1) {
            TEST_ASSERT_EQUAL(ProfileStore::Ok, after.load("a", p));
        }
    }
}

// the wear claim: saves erase a sector, switches append and erase once in 511
void test_flash_writes_per_ordinary_day() {
    FakeFlash flash;
    ProfileStore s(flash);
    s.begin();
    s.save(make("a"));
    s.save(make("b"));
    s.setActive("a");  // the first append starts the pointer's first sector
    flash.resetCounters();
    for (int i = 0; i < 2; i++) {
        s.save(make("a", 30 + i, 90));
    }
    for (int i = 0; i < 10; i++) {
        s.setActive(i % 2 ? "a" : "b");
    }
    TEST_ASSERT_EQUAL(2, flash.erases());  // 2 saves and the 10 switches are appends with no erase
    for (int day = 0; day < 100; day++) {
        for (int i = 0; i < 2; i++) {
            s.save(make("a", 30, 90));
        }
        for (int i = 0; i < 10; i++) {
            s.setActive(i % 2 ? "a" : "b");
        }
    }
    uint32_t most = 0;
    for (uint32_t i = 0; i < flash.sectorCount(); i++) {
        if (flash.wear(i) > most) {
            most = flash.wear(i);
        }
    }
    TEST_ASSERT_TRUE(most <= 105);  // 200 saves of profile a alternate its two sectors: 100 each
}

// what a hostile sender can do in a day, against the limits
void test_a_loop_of_commands_cannot_wear_the_flash_out_faster_than_the_stated_figures() {
    FakeFlash flash;
    FakeClock clock;
    ProfileStore s(flash, &clock);
    s.begin();
    clock.advance(100000);
    TEST_ASSERT_EQUAL(ProfileStore::Ok, s.save(make("a")));
    clock.advance(61000);
    TEST_ASSERT_EQUAL(ProfileStore::Ok, s.save(make("b")));
    TEST_ASSERT_EQUAL(ProfileStore::Ok, s.setActive("a"));
    TEST_ASSERT_EQUAL(ProfileStore::TooSoon, s.setActive("b"));  // inside 2 s
    TEST_ASSERT_EQUAL(ProfileStore::TooSoon, s.save(make("c")));   // inside a minute
    TEST_ASSERT_NOT_NULL(strstr(ProfileStore::message(ProfileStore::TooSoon), "wait"));
    // a day of `profile switch` as fast as allowed and a save every minute
    long switches = 0, saves = 0;
    for (long t = 0; t < 86400; t += 2) {
        clock.advance(2000);
        switches += s.setActive((t / 2) % 2 ? "a" : "b") == ProfileStore::Ok;
        if (t % 60 == 0) {
            saves += s.save(make("a", 30, (int)(90 + t / 60 % 2))) == ProfileStore::Ok;
        }
    }
    TEST_ASSERT_TRUE(switches > 40000);
    TEST_ASSERT_TRUE(saves > 1000);
    uint32_t logWear = std::max(flash.wear(16), flash.wear(17));
    TEST_ASSERT_TRUE(logWear <= 43);  // 43 200 switches / 1022 per sector erase: the pointer's sectors
    uint32_t profileWear = std::max(flash.wear(0), flash.wear(1)) + std::max(flash.wear(2), flash.wear(3));
    TEST_ASSERT_TRUE(profileWear <= 760);  // a save a minute for a day over the profile's two sectors (360 or so each)
}

void test_removing_the_active_profile_clears_the_pointer_so_a_reused_slot_is_not_activated() {
    FakeFlash flash;
    ProfileStore s(flash);
    s.begin();
    s.save(make("a"));
    s.setActive("a");
    s.remove("a");
    s.save(make("b"));  // takes the freed index
    char id[40];
    TEST_ASSERT_FALSE(s.activeId(id, sizeof id));
    TEST_ASSERT_EQUAL_STRING("piano-88", s.activeOrDefault().id);
}

void test_the_list_of_eight_profiles_with_long_names_fits_the_reply() {
    FakeFlash flash;
    ProfileStore s(flash);
    s.begin();
    for (int i = 0; i < 8; i++) {
        Profile p = make("placeholder");
        int written = snprintf(p.id, sizeof p.id, "long-profile-identifier-%02d-xxxx", i);
        TEST_ASSERT_TRUE(written > 0 && written < (int)sizeof p.id);
        memset(p.name, 'N', 64);
        p.name[64] = 0;
        TEST_ASSERT_EQUAL(ProfileStore::Ok, s.save(p));
    }
    char reply[1200];
    TEST_ASSERT_TRUE(handleProfileCommand(s, "list", 4, reply, sizeof reply, nullptr));
    TEST_ASSERT_TRUE(strlen(reply) > 800);  // nearly the 920 bytes the longest list needs
    TEST_ASSERT_NOT_NULL(strstr(reply, "-07-xxxx"));  // the last of the eight is in it
}

static bool command(ProfileStore &s, const char *msg, char *reply, size_t cap, bool *changed = nullptr) {
    return handleProfileCommand(s, msg, strlen(msg), reply, cap, changed);
}

void test_studio_commands_list_switch_and_reject() {
    FakeFlash flash;
    ProfileStore store(flash);
    store.begin();
    char reply[400];
    bool changed;
    TEST_ASSERT_TRUE(command(store, (std::string("put ") + kGood).c_str(), reply, sizeof reply, &changed));
    TEST_ASSERT_TRUE(command(store, "list", reply, sizeof reply));
    TEST_ASSERT_NOT_NULL(strstr(reply, "\"id\":\"mine\""));
    TEST_ASSERT_TRUE(command(store, "switch mine", reply, sizeof reply, &changed));
    TEST_ASSERT_TRUE(changed);
    TEST_ASSERT_EQUAL_STRING("mine", store.activeOrDefault().id);
    TEST_ASSERT_FALSE(command(store, "switch nothere", reply, sizeof reply, &changed));
    TEST_ASSERT_FALSE(changed);
    TEST_ASSERT_NOT_NULL(strstr(reply, "no profile with that id"));
    TEST_ASSERT_FALSE(command(store, "put {\"id\":\"x\"}", reply, sizeof reply));
    TEST_ASSERT_NOT_NULL(strstr(reply, "\"ok\":false"));
    TEST_ASSERT_FALSE(command(store, "format", reply, sizeof reply));
    TEST_ASSERT_FALSE(command(store, "switch", reply, sizeof reply));
    TEST_ASSERT_FALSE(command(store, "listing", reply, sizeof reply));
    // a reply buffer that is too small gives a short valid string and no overrun
    char tiny[8];
    TEST_ASSERT_FALSE(command(store, "list", tiny, sizeof tiny));
    TEST_ASSERT_TRUE(strlen(tiny) < sizeof tiny);
    // a refused profile does not disturb the stored one
    TEST_ASSERT_EQUAL(1, store.count());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_shipped_profiles_are_accepted);
    RUN_TEST(test_invalid_corpus_is_refused_with_a_message);
    RUN_TEST(test_parse_rounds_values_and_bounds_led_count);
    RUN_TEST(test_hostile_documents_never_pass);
    RUN_TEST(test_decode_refuses_a_record_that_passes_its_checksum_but_is_out_of_range);
    RUN_TEST(test_store_saves_lists_switches_and_survives_a_restart);
    RUN_TEST(test_store_limit_is_eight_profiles_and_a_ninth_is_refused);
    RUN_TEST(test_a_too_small_chip_is_reported);
    RUN_TEST(test_corrupt_records_are_ignored);
    RUN_TEST(test_power_cut_at_every_step_leaves_old_or_new);
    RUN_TEST(test_power_cut_during_a_first_save_gives_nothing_or_the_whole_profile);
    RUN_TEST(test_power_cut_while_switching_keeps_old_or_new_active);
    RUN_TEST(test_power_cut_while_removing);
    RUN_TEST(test_flash_writes_per_ordinary_day);
    RUN_TEST(test_a_loop_of_commands_cannot_wear_the_flash_out_faster_than_the_stated_figures);
    RUN_TEST(test_removing_the_active_profile_clears_the_pointer_so_a_reused_slot_is_not_activated);
    RUN_TEST(test_the_list_of_eight_profiles_with_long_names_fits_the_reply);
    RUN_TEST(test_studio_commands_list_switch_and_reject);
    return UNITY_END();
}
