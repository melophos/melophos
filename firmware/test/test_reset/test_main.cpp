#include <string.h>
#include <unity.h>

#include "../support/fakes.h"
#include "factoryreset.h"
#include "outbox.h"
#include "profilestore.h"
#include "recordpair.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

void test_factory_reset_erases_the_identity_the_profiles_and_the_last_session_and_keeps_the_counters() {
    FakeKv kv;
    IdentityStore id(kv);
    const char *why;
    id.setWifi("HomeNet", "password123", &why);
    id.setDevice("hub-k7qm2xpd", "abcdefghij0123", &why);
    id.setPaired(true);
    FakeFlash profiles(20), outbox(4), state(6);
    ProfileStore store(profiles);
    store.begin();
    Profile p = defaultProfile();
    strcpy(p.id, "mine");
    store.save(p);
    store.setActive("mine");
    StoredEvent ev[3] = {{1000, 60, 80, 0, 0}, {1100, 61, 80, 0, 0}, {1200, 62, 80, 0, 0}};
    {
        Outbox box(outbox, 0);
        QueueEntry e{};
        strcpy(e.ref, "b1-s1");
        strcpy(e.profile, "mine");
        e.startWall = 1767225600;
        e.startMono = 1000;
        box.sessionEnded(e, ev, 3);
        static Outbox::Saved saved;
        TEST_ASSERT_TRUE(box.load(saved));
    }
    DurableCounter counter(state, 0, 1, 0x544F4F42);
    counter.next();
    counter.next();
    TEST_ASSERT_TRUE(factoryReset(id, profiles, outbox));
    TEST_ASSERT_EQUAL(0, (int)kv.data.size());
    ProfileStore after(profiles);
    after.begin();
    TEST_ASSERT_EQUAL(0, after.count());
    Outbox box2(outbox, 0);
    static Outbox::Saved saved2;
    TEST_ASSERT_FALSE(box2.load(saved2));  // the next owner never receives the last session
    for (auto b : outbox.raw()) {
        TEST_ASSERT_EQUAL(0xFF, b);
    }
    TEST_ASSERT_EQUAL(2, (int)counter.value());  // the boot counter must not go back
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_factory_reset_erases_the_identity_the_profiles_and_the_last_session_and_keeps_the_counters);
    return UNITY_END();
}
