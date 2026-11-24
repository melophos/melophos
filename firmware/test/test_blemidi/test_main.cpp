#include <unity.h>

#include "../support/fakes.h"
#include "blemidi.h"
#include "hub.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

static const uint8_t kOn60[] = {0x80, 0x80, 0x90, 60, 100};
static const uint8_t kOff60[] = {0x80, 0x80, 0x80, 60, 0};

void test_synthesia_notes_light_and_clear_the_guides() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    link.begin();
    TEST_ASSERT_EQUAL(1, port.advertising);
    link.onConnect();
    link.onEncrypted(true);
    link.onReceive(kOn60, sizeof kOn60, 0);
    TEST_ASSERT_TRUE(guides.test(60));
    link.onReceive(kOff60, sizeof kOff60, 1);
    TEST_ASSERT_FALSE(guides.test(60));
}

void test_a_lost_note_off_cannot_leave_a_light_stuck() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    link.onConnect();
    link.onEncrypted(true);
    link.onReceive(kOn60, sizeof kOn60, 0);
    uint8_t allOff[] = {0x80, 0x80, 0xB0, 123, 0};
    link.onReceive(allOff, sizeof allOff, 1);
    TEST_ASSERT_FALSE(guides.test(60));
    link.onReceive(kOn60, sizeof kOn60, 2);
    link.onDisconnect();
    TEST_ASSERT_FALSE(guides.test(60));
    TEST_ASSERT_EQUAL(1, port.advertising);  // advertising again so the next host can connect
    link.onReceive(kOn60, sizeof kOn60, 3);  // data after the link is gone is ignored
    TEST_ASSERT_FALSE(guides.test(60));
}

void test_guides_reach_the_engine_as_guide_cues_in_every_mode() {
    GuideSet guides;
    guides.set(64, true);
    PracticeEngine engine;
    engine.setExternalGuides(&guides);
    CueList list;
    engine.collect(0, list);  // mode Off: free play
    TEST_ASSERT_EQUAL(1, (int)list.count);
    TEST_ASSERT_TRUE(list.cue[0].role == LightRole::Guide);
    TEST_ASSERT_EQUAL(64, list.cue[0].note);
    guides.set(200, true);  // out of range is ignored by the set
    TEST_ASSERT_FALSE(guides.test(200));
}

void test_played_notes_go_back_as_midi_input() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    link.onConnect();
    link.onEncrypted(true);
    link.queueOut(NoteEvent{1000, 60, 90, 0, NoteSource::UsbMidi});
    link.pump();
    TEST_ASSERT_EQUAL(0, (int)port.sent.size());  // not subscribed yet: nothing is sent
    link.onSubscribe(true);
    link.queueOut(NoteEvent{1000, 60, 90, 0, NoteSource::UsbMidi});
    link.queueOut(NoteEvent{1010, 60, 0, 0, NoteSource::UsbMidi});
    link.pump();
    TEST_ASSERT_EQUAL(1, (int)port.sent.size());
    TEST_ASSERT_EQUAL(9, (int)port.sent[0].size());  // header and two 4 byte messages
    // what the host receives parses back to the same notes
    BleMidiParser p;
    CollectSink s;
    p.feedPacket(port.sent[0].data(), port.sent[0].size(), 0, s);
    TEST_ASSERT_EQUAL(2, (int)s.notes.size());
    TEST_ASSERT_EQUAL(60, s.notes[0].note);
    TEST_ASSERT_EQUAL(0, s.notes[1].velocity);
}

void test_out_queue_is_bounded_and_a_busy_stack_is_retried() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    link.onConnect();
    link.onEncrypted(true);
    link.onSubscribe(true);
    port.accept = false;
    for (int i = 0; i < 50; i++) {
        link.queueOut(NoteEvent{(uint32_t)i, (uint8_t)(40 + i % 40), 80, 0, NoteSource::UsbMidi});
        link.pump();
    }
    TEST_ASSERT_EQUAL(50 - 8, (int)link.outDropped());
    port.accept = true;
    int guard = 0;
    while (port.sent.size() < 3 && guard++ < 10) {
        link.pump();
    }
    TEST_ASSERT_EQUAL(3, (int)port.sent.size());  // 8 queued, 3 per packet: 3 + 3 + 2
    size_t total = 0;
    for (auto &p : port.sent) {
        TEST_ASSERT_TRUE(p.size() <= 13);  // within a 20 byte payload
        total += (p.size() - 1) / 4;
    }
    TEST_ASSERT_EQUAL(8, (int)total);
}

void test_a_stranger_cannot_write_guide_lights_and_pairing_is_a_short_deliberate_window() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    TEST_ASSERT_FALSE(link.acceptConnection(false, 1000));   // not bonded and pairing is closed
    TEST_ASSERT_TRUE(link.acceptConnection(true, 1000));     // a bonded phone is fine
    link.openPairing(5000);                                  // the owner asked for it
    TEST_ASSERT_TRUE(link.acceptConnection(false, 5000 + PairingWindow::kOpenMs - 1));
    TEST_ASSERT_FALSE(link.acceptConnection(false, 5000 + PairingWindow::kOpenMs));  // it closes by itself
    // an unencrypted link can connect (to pair) but its writes light nothing
    link.onConnect();
    link.onReceive(kOn60, sizeof kOn60, 0);
    TEST_ASSERT_FALSE(guides.test(60));
    link.onEncrypted(true);
    link.onReceive(kOn60, sizeof kOn60, 1);
    TEST_ASSERT_TRUE(guides.test(60));
    link.onDisconnect();
    TEST_ASSERT_FALSE(link.encrypted());
}

static PeerAddr addr(uint8_t last, uint8_t type = 0) {
    PeerAddr a;
    a.bytes[0] = 0xC0;
    a.bytes[5] = last;
    a.type = type;
    return a;
}

// brings the host 1 to the accepted state the way the owner would: pairing open, connect, accept
static void acceptHost(BleMidiLink &link, uint16_t handle, const PeerAddr &a, uint32_t at) {
    link.openPairing(at);
    TEST_ASSERT_TRUE(link.onPeerConnect(handle, a, at + 1) == BleMidiLink::Peer::Waiting);
    link.onPeerEncrypted(handle);
    TEST_ASSERT_TRUE(link.acceptWaiting());
}

void test_a_newly_bonded_device_waits_for_the_owner_and_cannot_disturb_the_real_host() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    acceptHost(link, 1, addr(1), 1000);
    link.onPeerReceive(1, kOn60, sizeof kOn60, 1001);
    TEST_ASSERT_TRUE(guides.test(60));
    // a stranger bonds inside a window the owner opened
    link.openPairing(2000);
    TEST_ASSERT_TRUE(link.onPeerConnect(2, addr(2), 2001) == BleMidiLink::Peer::Waiting);
    link.onPeerEncrypted(2);  // Just Works pairing completed: still only waiting
    uint8_t strangerNote[] = {0x80, 0x80, 0x90, 70, 100};
    link.onPeerReceive(2, strangerNote, sizeof strangerNote, 2002);
    TEST_ASSERT_FALSE(guides.test(70));
    link.queueOut(NoteEvent{2003, 61, 90, 0, NoteSource::UsbMidi});
    TEST_ASSERT_EQUAL(0, (int)link.outDropped());
    // its disconnect does not touch the real host's link or lights and its bond is deleted at once
    link.onPeerDisconnect(2);
    TEST_ASSERT_TRUE(guides.test(60));
    TEST_ASSERT_TRUE(link.encrypted());
    PeerAddr gone;
    TEST_ASSERT_TRUE(link.takeBondToDelete(gone));
    TEST_ASSERT_TRUE(gone == addr(2));
    TEST_ASSERT_FALSE(link.takeBondToDelete(gone));
    // a second stranger while one waits and one with the window closed, are refused (and their bonds deleted)
    link.openPairing(3000);
    TEST_ASSERT_TRUE(link.onPeerConnect(3, addr(3), 3001) == BleMidiLink::Peer::Waiting);
    TEST_ASSERT_TRUE(link.onPeerConnect(4, addr(4), 3002) == BleMidiLink::Peer::Refused);
    TEST_ASSERT_TRUE(link.takeBondToDelete(gone));
    TEST_ASSERT_TRUE(gone == addr(4));
    // the owner does not confirm: when the window closes the waiting device is dropped and its bond deleted
    TEST_ASSERT_FALSE(link.expireWaiting(3000 + PairingWindow::kOpenMs - 1));
    TEST_ASSERT_TRUE(link.expireWaiting(3000 + PairingWindow::kOpenMs));
    TEST_ASSERT_EQUAL(0, link.waitingHandle());
    TEST_ASSERT_TRUE(link.takeBondToDelete(gone));
    TEST_ASSERT_TRUE(gone == addr(3));
    TEST_ASSERT_TRUE(guides.test(60));
}

void test_the_owner_confirms_a_waiting_device_and_only_then_its_writes_count() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    link.openPairing(0);
    TEST_ASSERT_TRUE(link.onPeerConnect(7, addr(7), 10) == BleMidiLink::Peer::Waiting);
    link.onPeerEncrypted(7);
    link.onPeerReceive(7, kOn60, sizeof kOn60, 15);
    TEST_ASSERT_FALSE(guides.test(60));  // not before the owner says yes
    TEST_ASSERT_TRUE(link.acceptWaiting());
    TEST_ASSERT_EQUAL(7, link.trustedHandle());
    TEST_ASSERT_TRUE(link.takeAcceptedChanged());
    link.onPeerReceive(7, kOn60, sizeof kOn60, 20);
    TEST_ASSERT_TRUE(guides.test(60));
    TEST_ASSERT_FALSE(link.acceptWaiting());
    uint8_t other[] = {0x80, 0x80, 0x90, 71, 100};
    link.onPeerReceive(99, other, sizeof other, 30);
    TEST_ASSERT_FALSE(guides.test(71));
}

// a gap: the stack stores a bond before `ble accept`, so after a restart (or for a phone that uses a
// random address) a bond the owner never accepted comes back. Only the hub's own list counts
void test_a_bond_the_owner_never_accepted_is_not_trusted_after_a_restart_or_with_a_random_address() {
    FakeBlePort port;
    GuideSet guides;
    {
        BleMidiLink first(port, guides);
        first.openPairing(0);
        TEST_ASSERT_TRUE(first.onPeerConnect(5, addr(9, 1), 10) == BleMidiLink::Peer::Waiting);  // a random-address phone
        first.onPeerEncrypted(5);  // the stack now holds its bond. The hub restarts before `ble accept`
    }
    BleMidiLink second(port, guides);  // a restart: no list entry
    PeerAddr bonds[2] = {addr(9, 1), addr(1)};
    second.auditBonds(bonds, 2);
    PeerAddr gone;
    int deleted = 0;
    while (second.takeBondToDelete(gone)) {
        deleted++;
    }
    TEST_ASSERT_EQUAL(2, deleted);  // every bond not on the list is deleted at start-up
    // and if the bond survived anyway the device reconnecting is not trusted
    TEST_ASSERT_FALSE(second.onPeerConnect(6, addr(9, 1), 1000) == BleMidiLink::Peer::Trusted);
    second.onPeerEncrypted(6);
    second.onPeerReceive(6, kOn60, sizeof kOn60, 1001);
    TEST_ASSERT_FALSE(guides.test(60));
    // the same six bytes with the other address type are another identity
    acceptHost(second, 8, addr(1, 0), 2000);
    second.onPeerDisconnect(8);
    TEST_ASSERT_FALSE(second.onPeerConnect(9, addr(1, 1), 5000) == BleMidiLink::Peer::Trusted);
    // an accepted device keeps its bond: it is never queued for deletion
    PeerAddr keep[1] = {addr(1, 0)};
    second.auditBonds(keep, 1);
    TEST_ASSERT_FALSE(second.takeBondToDelete(gone) && gone == addr(1, 0));
}

void test_the_accepted_list_survives_a_restart_as_text_and_rejects_bad_text() {
    AcceptedPeers a;
    TEST_ASSERT_TRUE(a.add(addr(1)));
    TEST_ASSERT_TRUE(a.add(addr(2, 1)));
    TEST_ASSERT_FALSE(a.add(PeerAddr()));  // an all zero address is no identity
    char text[AcceptedPeers::kTextMax];
    a.toText(text, sizeof text);
    AcceptedPeers b;
    TEST_ASSERT_TRUE(b.fromText(text));
    TEST_ASSERT_TRUE(b.contains(addr(1)) && b.contains(addr(2, 1)) && !b.contains(addr(2, 0)));
    // a restarted link trusts it
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    TEST_ASSERT_TRUE(link.accepted().fromText(text));
    TEST_ASSERT_TRUE(link.onPeerConnect(3, addr(2, 1), 0) == BleMidiLink::Peer::Trusted);
    // hostile text empties the list instead of half loading it
    for (const char *bad : {"zz", "C00000000001/2", "C00000000001/0X", "C0000000000", "C00000000001/0 C0"}) {
        AcceptedPeers c;
        TEST_ASSERT_FALSE(c.fromText(bad));
        TEST_ASSERT_EQUAL(0, (int)c.count());
    }
    // a fifth device pushes the oldest out
    AcceptedPeers d;
    for (uint8_t i = 1; i <= 5; i++) {
        d.add(addr(i));
    }
    TEST_ASSERT_EQUAL(4, (int)d.count());
    TEST_ASSERT_FALSE(d.contains(addr(1)));
    TEST_ASSERT_TRUE(d.contains(addr(5)));
}

void test_hostile_bluetooth_input_is_counted_and_harmless() {
    FakeBlePort port;
    GuideSet guides;
    BleMidiLink link(port, guides);
    link.onConnect();
    link.onEncrypted(true);
    uint32_t seed = 99;
    for (int i = 0; i < 20000; i++) {
        uint8_t pkt[20];
        size_t n = (seed >> 8) % 21;
        for (size_t k = 0; k < n; k++) {
            seed = seed * 1664525u + 1013904223u;
            pkt[k] = (uint8_t)(seed >> 24);
        }
        link.onReceive(pkt, n, (uint32_t)i);
    }
    TEST_ASSERT_TRUE(link.badPackets() > 0);
    // whatever the noise lit, a lost link leaves nothing lit
    link.onDisconnect();
    for (int n = 0; n < 128; n++) {
        TEST_ASSERT_FALSE(guides.test((uint8_t)n));
    }
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_synthesia_notes_light_and_clear_the_guides);
    RUN_TEST(test_a_lost_note_off_cannot_leave_a_light_stuck);
    RUN_TEST(test_guides_reach_the_engine_as_guide_cues_in_every_mode);
    RUN_TEST(test_played_notes_go_back_as_midi_input);
    RUN_TEST(test_out_queue_is_bounded_and_a_busy_stack_is_retried);
    RUN_TEST(test_a_stranger_cannot_write_guide_lights_and_pairing_is_a_short_deliberate_window);
    RUN_TEST(test_a_newly_bonded_device_waits_for_the_owner_and_cannot_disturb_the_real_host);
    RUN_TEST(test_the_owner_confirms_a_waiting_device_and_only_then_its_writes_count);
    RUN_TEST(test_a_bond_the_owner_never_accepted_is_not_trusted_after_a_restart_or_with_a_random_address);
    RUN_TEST(test_the_accepted_list_survives_a_restart_as_text_and_rejects_bad_text);
    RUN_TEST(test_hostile_bluetooth_input_is_counted_and_harmless);
    return UNITY_END();
}
