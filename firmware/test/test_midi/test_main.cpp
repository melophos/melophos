#include <string.h>
#include <unity.h>

#include <vector>

#include "../support/fakes.h"
#include "midi.h"
#include "practice.h"
#include <stdio.h>
#include <stdlib.h>
#include <map>

using namespace melophos;

void setUp() {}
void tearDown() {}

static void feedAll(MidiParser &p, CollectSink &s, std::vector<uint8_t> bytes, uint32_t t = 0) {
    for (uint8_t b : bytes) {
        p.feed(b, t, s);
    }
}

void test_note_on_and_off() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {0x93, 60, 100, 0x83, 60, 40});
    TEST_ASSERT_EQUAL(2, (int)s.notes.size());
    TEST_ASSERT_EQUAL(60, s.notes[0].note);
    TEST_ASSERT_EQUAL(100, s.notes[0].velocity);
    TEST_ASSERT_EQUAL(3, s.notes[0].channel);
    TEST_ASSERT_TRUE(s.notes[0].source == NoteSource::MidiJack);
    TEST_ASSERT_EQUAL(0, s.notes[1].velocity);  // a note off is velocity 0 on the bus
}

void test_running_status_and_velocity_zero() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {0x90, 60, 90, 62, 91, 64, 0});
    TEST_ASSERT_EQUAL(3, (int)s.notes.size());
    TEST_ASSERT_EQUAL(62, s.notes[1].note);
    TEST_ASSERT_EQUAL(0, s.notes[2].velocity);
}

void test_realtime_bytes_inside_a_message_change_nothing() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {0x90, 0xF8, 60, 0xFE, 0xF8, 100, 0xF8});
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    TEST_ASSERT_EQUAL(60, s.notes[0].note);
    TEST_ASSERT_EQUAL(100, s.notes[0].velocity);
    TEST_ASSERT_EQUAL(0, (int)p.stats().malformed);
}

void test_truncated_message_is_dropped_and_the_next_is_clean() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {0x90, 60, 0x90, 62, 100});  // the first lost its velocity
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    TEST_ASSERT_EQUAL(62, s.notes[0].note);
    TEST_ASSERT_EQUAL(1, (int)p.stats().malformed);
}

void test_stray_data_without_status_is_counted_not_played() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {60, 100, 62});
    TEST_ASSERT_EQUAL(0, (int)s.notes.size());
    TEST_ASSERT_EQUAL(3, (int)p.stats().malformed);
}

void test_sysex_is_skipped_and_never_buffered() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    std::vector<uint8_t> msg = {0xF0, 0x7D};
    for (int i = 0; i < 5000; i++) {
        msg.push_back(0x40);  // a long dump of data bytes that look like notes
    }
    msg.push_back(0xF7);
    msg.insert(msg.end(), {0x90, 60, 100});
    feedAll(p, s, msg);
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    TEST_ASSERT_EQUAL(5001, (int)p.stats().sysexBytes);
}

void test_sysex_without_an_end_is_ended_by_the_next_status_or_a_stall() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {0xF0, 1, 2, 3, 0x90, 60, 100});  // a status byte ends it
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    TEST_ASSERT_EQUAL(1, (int)p.stats().malformed);
    MidiParser q(NoteSource::MidiJack);
    CollectSink t;
    q.feed(0xF0, 0, t);
    q.feed(5, 10, t);
    // nothing for a second: the stream recovered, so these bytes are not sysex
    q.feed(0x90, 2000, t);
    q.feed(61, 2000, t);
    q.feed(100, 2000, t);
    TEST_ASSERT_EQUAL(1, (int)t.notes.size());
}

void test_a_stalled_partial_message_does_not_swallow_the_next() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    p.feed(0x90, 0, s);
    p.feed(60, 1, s);
    // the cable was pulled here: a status arrives much later
    p.feed(0x90, 5000, s);
    p.feed(62, 5001, s);
    p.feed(80, 5001, s);
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    TEST_ASSERT_EQUAL(62, s.notes[0].note);
}

void test_system_common_cancels_running_status_and_other_channel_messages_are_ignored() {
    MidiParser p(NoteSource::MidiJack);
    CollectSink s;
    feedAll(p, s, {0x90, 60, 100, 0xF6, 62, 100});  // running status is gone after tune request
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    feedAll(p, s, {0xC0, 5, 0xE0, 1, 2, 0xB0, 7, 100});  // program change, pitch bend, a controller
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    feedAll(p, s, {0xB0, 123, 0});
    TEST_ASSERT_EQUAL(1, s.allOff);
}

void test_flood_is_bounded_by_the_bus() {
    MidiParser p(NoteSource::MidiJack);
    NoteBus bus;
    BusSink sink(bus);
    for (int i = 0; i < 100000; i++) {
        p.feed(0x90, 0, sink);
        p.feed(60, 0, sink);
        p.feed(100, 0, sink);
    }
    TEST_ASSERT_EQUAL(255, (int)bus.size());
    TEST_ASSERT_TRUE(bus.dropped() > 99000);
}

// ----- the owner's test keyboard, as it really sends -----

// test/data/visionkey-100-capture.txt: what the Gear4music VISIONKEY-100 sent over USB (83 messages, releases as note-on
// with velocity 0, three releases at the start whose presses never arrived). It goes through the same path a USB MIDI
// message takes on the hub: USB-MIDI packets, the parser, the note bus and the practice engine
void test_the_visionkey_100_capture_through_the_hub_path() {
    FILE *f = fopen("test/data/visionkey-100-capture.txt", "r");
    TEST_ASSERT_NOT_NULL(f);
    struct Msg {
        uint32_t ms;
        unsigned st, note, vel;
    };
    std::vector<Msg> msgs;
    char line[120];
    while (fgets(line, sizeof line, f)) {
        if (line[0] == '#' || line[0] == '\n') continue;
        Msg m;
        TEST_ASSERT_EQUAL(4, sscanf(line, "%u %x %x %x", &m.ms, &m.st, &m.note, &m.vel));
        msgs.push_back(m);
    }
    fclose(f);
    TEST_ASSERT_EQUAL(83, (int)msgs.size());

    NoteBus bus;
    BusSink sink(bus);
    UsbMidiParser parser;
    for (auto &m : msgs) {
        uint8_t packet[4] = {(uint8_t)(0x00 | (m.st >> 4)), (uint8_t)m.st, (uint8_t)m.note, (uint8_t)m.vel};  // cable 0, code index = status high nibble
        parser.feedTransfer(packet, 4, m.ms, sink);
    }
    TEST_ASSERT_EQUAL(0, (int)parser.stats().malformed);
    TEST_ASSERT_EQUAL(83, (int)parser.stats().notes);

    // an engine in free play: every event goes to it as the hub does
    PracticeEngine engine;
    PracticeSettings ps;
    static LessonStep step[] = {{0, 1, {60}, 0}};
    char msg[80];
    TEST_ASSERT_TRUE(engine.start(Mode::Melody, Lesson{step, 1}, ps, 0, msg, sizeof msg));
    std::map<int, int> held;  // our own count of which notes are down
    size_t i = 0;
    int presses = 0, releases = 0, unmatched = 0;
    NoteEvent e;
    uint32_t last = 0;
    while (bus.pop(e)) {
        TEST_ASSERT_TRUE(i < msgs.size());
        TEST_ASSERT_EQUAL(msgs[i].note, e.note);
        TEST_ASSERT_TRUE(e.source == NoteSource::UsbMidi);
        if (msgs[i].vel > 0) {
            TEST_ASSERT_EQUAL_MESSAGE(msgs[i].vel, e.velocity, "a velocity changed on the way");  // 21 to 95 unchanged
            presses++;
            held[e.note]++;
        } else {
            TEST_ASSERT_EQUAL(0, e.velocity);  // a release is a note-on with velocity 0, ends the note
            releases++;
            if (held[e.note] == 0) {
                unmatched++;  // a release whose press never arrived: ignored, nothing goes negative
            } else {
                held[e.note]--;
            }
        }
        engine.onNote(e);
        last = e.timeMs;
        i++;
    }
    TEST_ASSERT_EQUAL((int)msgs.size(), (int)i);
    // the capture holds FOUR releases without a press (notes 0x3E, 0x43, 0x41 and 0x2F, all in the first burst), not three
    // and its last key press (note 0x16) has no release because the listen ended with the key down. Everything else matches
    TEST_ASSERT_EQUAL(4, unmatched);
    for (auto &kv : held) {
        TEST_ASSERT_EQUAL_MESSAGE(kv.first == 0x16 ? 1 : 0, kv.second, "a note other than the key still down at the end of the capture is left sounding");
    }
    TEST_ASSERT_EQUAL(presses + releases, (int)msgs.size());
    // and the engine takes it all without trouble: after the key still down is released nothing is left on
    engine.onNote(NoteEvent{last + 10, 0x16, 0, 0, NoteSource::UsbMidi});
    CueList cues;
    engine.tick(last + 5000);
    engine.collect(last + 5000, cues);
    for (size_t k = 0; k < cues.count; k++) TEST_ASSERT_TRUE(cues.cue[k].role != LightRole::Played);
}

// ----- USB-MIDI packets -----

void test_usb_packets() {
    UsbMidiParser p;
    CollectSink s;
    uint8_t data[] = {0x09, 0x90, 60, 100, 0x08, 0x80, 60, 0, 0x0C, 0xC0, 5, 0, 0x04, 0xF0, 1, 2, 0x0F, 0xF8, 0, 0};
    p.feedTransfer(data, sizeof data, 7, s);
    TEST_ASSERT_EQUAL(2, (int)s.notes.size());
    TEST_ASSERT_TRUE(s.notes[0].source == NoteSource::UsbMidi);
    TEST_ASSERT_EQUAL(100, s.notes[0].velocity);
    TEST_ASSERT_EQUAL(0, s.notes[1].velocity);
    TEST_ASSERT_EQUAL(7, s.notes[0].timeMs);
}

void test_usb_hostile_packets_are_refused() {
    UsbMidiParser p;
    CollectSink s;
    uint8_t badData[] = {0x09, 0x90, 200, 100};   // data byte with bit 7
    uint8_t noStatus[] = {0x09, 0x10, 60, 100};   // no status byte
    uint8_t mismatch[] = {0x09, 0x80, 60, 100};   // code index says note on, status says note off
    uint8_t shortOne[] = {0x09, 0x90, 60};        // incomplete
    p.feedTransfer(badData, 4, 0, s);
    p.feedTransfer(noStatus, 4, 0, s);
    p.feedTransfer(mismatch, 4, 0, s);
    p.feedTransfer(shortOne, 3, 0, s);
    p.feedTransfer(nullptr, 8, 0, s);
    p.feedTransfer(badData, 0, 0, s);
    TEST_ASSERT_EQUAL(0, (int)s.notes.size());
    TEST_ASSERT_EQUAL(4, (int)p.stats().malformed);
    // a whole good packet followed by a stub still delivers the good one
    uint8_t mixed[] = {0x09, 0x90, 60, 100, 0x09, 0x90};
    p.feedTransfer(mixed, sizeof mixed, 0, s);
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
}

// ----- Bluetooth MIDI -----

void test_ble_packets_with_running_status_and_timestamps() {
    BleMidiParser p;
    CollectSink s;
    // header, ts, note on, ts, running-status note, ts, note off
    uint8_t pkt[] = {0x80 | 0x12, 0x80 | 0x34, 0x90, 60, 100, 0x80 | 0x35, 62, 90, 0x80 | 0x36, 0x80, 60, 0};
    p.feedPacket(pkt, sizeof pkt, 5, s);
    TEST_ASSERT_EQUAL(3, (int)s.notes.size());
    TEST_ASSERT_TRUE(s.notes[0].source == NoteSource::BleMidi);
    TEST_ASSERT_EQUAL(62, s.notes[1].note);
    TEST_ASSERT_EQUAL(0, s.notes[2].velocity);
    TEST_ASSERT_EQUAL(0, (int)p.badPackets());
}

void test_ble_hostile_packets() {
    BleMidiParser p;
    CollectSink s;
    uint8_t noHeader[] = {0x10, 0x90, 60, 100};
    uint8_t twoByte[] = {0x80, 0x90};
    uint8_t headerOnlyBit6[] = {0xC0, 0x80, 0x90, 60, 100};
    p.feedPacket(noHeader, sizeof noHeader, 0, s);
    p.feedPacket(twoByte, sizeof twoByte, 0, s);
    p.feedPacket(headerOnlyBit6, sizeof headerOnlyBit6, 0, s);
    p.feedPacket(nullptr, 20, 0, s);
    TEST_ASSERT_EQUAL(0, (int)s.notes.size());
    TEST_ASSERT_EQUAL(4, (int)p.badPackets());
    // a message with no timestamp byte is not played
    uint8_t noTs[] = {0x80, 0x90, 60, 100};  // header then status straight away
    p.feedPacket(noTs, sizeof noTs, 0, s);
    // here 0x90 is read as the timestamp, so 60 and 100 have no status
    TEST_ASSERT_EQUAL(0, (int)s.notes.size());
}

void test_ble_sysex_spanning_packets() {
    BleMidiParser p;
    CollectSink s;
    uint8_t one[] = {0x80, 0x80, 0xF0, 1, 2, 3};
    uint8_t two[] = {0x80, 4, 5, 0x81, 0xF7, 0x82, 0x90, 60, 100};
    p.feedPacket(one, sizeof one, 0, s);
    p.feedPacket(two, sizeof two, 1, s);
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
}

void test_ble_encode_round_trip() {
    uint8_t out[5];
    NoteEvent e{0x1234, 64, 90, 2, NoteSource::UsbMidi};
    TEST_ASSERT_EQUAL(5, (int)encodeBleNote(e, out));
    BleMidiParser p;
    CollectSink s;
    p.feedPacket(out, 5, 0, s);
    TEST_ASSERT_EQUAL(1, (int)s.notes.size());
    TEST_ASSERT_EQUAL(64, s.notes[0].note);
    TEST_ASSERT_EQUAL(90, s.notes[0].velocity);
    TEST_ASSERT_EQUAL(2, s.notes[0].channel);
    NoteEvent off{0, 64, 0, 2, NoteSource::UsbMidi};
    encodeBleNote(off, out);
    TEST_ASSERT_EQUAL(0x82, out[2]);
    NoteEvent bad{0, 200, 90, 2, NoteSource::UsbMidi};
    TEST_ASSERT_EQUAL(0, (int)encodeBleNote(bad, out));
    NoteEvent badChannel{0, 60, 90, 16, NoteSource::UsbMidi};
    TEST_ASSERT_EQUAL(0, (int)encodeBleNote(badChannel, out));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_note_on_and_off);
    RUN_TEST(test_running_status_and_velocity_zero);
    RUN_TEST(test_realtime_bytes_inside_a_message_change_nothing);
    RUN_TEST(test_truncated_message_is_dropped_and_the_next_is_clean);
    RUN_TEST(test_stray_data_without_status_is_counted_not_played);
    RUN_TEST(test_sysex_is_skipped_and_never_buffered);
    RUN_TEST(test_sysex_without_an_end_is_ended_by_the_next_status_or_a_stall);
    RUN_TEST(test_a_stalled_partial_message_does_not_swallow_the_next);
    RUN_TEST(test_system_common_cancels_running_status_and_other_channel_messages_are_ignored);
    RUN_TEST(test_flood_is_bounded_by_the_bus);
    RUN_TEST(test_usb_packets);
    RUN_TEST(test_the_visionkey_100_capture_through_the_hub_path);
    RUN_TEST(test_usb_hostile_packets_are_refused);
    RUN_TEST(test_ble_packets_with_running_status_and_timestamps);
    RUN_TEST(test_ble_hostile_packets);
    RUN_TEST(test_ble_sysex_spanning_packets);
    RUN_TEST(test_ble_encode_round_trip);
    return UNITY_END();
}
