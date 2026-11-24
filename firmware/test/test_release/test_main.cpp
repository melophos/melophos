// built only by `pio test -e native-release`, which defines MELOPHOS_RELEASE.
// A release build has no plain-MQTT path at all.
#include <unity.h>

#include "../support/fakes.h"
#include "identity.h"
#include "provision.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

void test_a_release_build_refuses_the_insecure_flag_and_ignores_a_stored_one() {
    FakeKv kv;
    IdentityStore s(kv);
    char reply[200];
    TEST_ASSERT_FALSE(handleProvisionCommand(s, "insecure on", 11, reply, sizeof reply));
    TEST_ASSERT_NOT_NULL(strstr(reply, "unknown command"));  // the command does not exist in a release build
    const char *whyNot = "";
    TEST_ASSERT_FALSE(s.setInsecure(true, &whyNot));
    TEST_ASSERT_NOT_NULL(strstr(whyNot, "release"));
    kv.data["insecure"] = "1";  // even if someone writes the flag straight into storage
    TEST_ASSERT_FALSE(s.insecure());
    handleProvisionCommand(s, "wifi HomeNet correct-horse", 26, reply, sizeof reply);
    handleProvisionCommand(s, "broker mqtt.example 1883", 24, reply, sizeof reply);
    handleProvisionCommand(s, "device hub-k7qm2xpd abcdefghij0123", 34, reply, sizeof reply);
    TEST_ASSERT_FALSE(s.readyInsecure());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_a_release_build_refuses_the_insecure_flag_and_ignores_a_stored_one);
    return UNITY_END();
}
