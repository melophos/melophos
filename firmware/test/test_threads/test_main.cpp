// the main loop and the network task share the offline queue and the status. This drives them from two
// threads. Run under ThreadSanitizer: pio test -e native-tsan -f test_threads
#include <atomic>
#include <mutex>
#include <thread>

#include <unity.h>

#include "../support/fakes.h"
#include "buzzer.h"

using namespace melophos;

void setUp() {}
void tearDown() {}

class MutexLock : public Lock {
   public:
    void lock() override { m_.lock(); }
    void unlock() override { m_.unlock(); }

   private:
    std::mutex m_;
};

class AtomicClock : public Clock {
   public:
    std::atomic<uint32_t> now{0};
    uint32_t nowMs() const override { return now.load(); }
};

void test_the_queue_and_the_status_survive_two_threads() {
    AtomicClock clock;
    MutexLock queueLock, statusLock;
    OfflineQueue queue;
    queue.setLock(&queueLock);
    FakeWall wall;
    wall.epoch = 1767225600;
    FakeMqtt mqtt;
    MqttLink link(clock, mqtt, queue, wall, "hub-a1b2c3d4e5f6", 1);
    link.setStatusLock(&statusLock);
    SessionPublisher pub(queue, wall, 1);
    std::atomic<bool> stop{false};

    // the network task: pumps the link and reads the status
    std::thread network([&] {
        while (!stop.load()) {
            link.pump();
            QueueEntry e;
            StoredEvent ev[kBatchMax];
            queue.frontWithEvents(e, ev, kBatchMax);
            queue.size();
            queue.droppedEvents();
        }
    });
    // the main loop: notes in, status out, time moving, sessions ending so the queue fills and drops
    for (int i = 0; i < 20000; i++) {
        clock.now.fetch_add(7);
        pub.onNote(NoteEvent{clock.now.load(), (uint8_t)(40 + i % 40), 80, 0, NoteSource::UsbMidi});
        pub.tick(clock.now.load());
        if (i % 50 == 0) {
            link.setStatus(StatusInfo{"0.1.0", "piano-88", true, false, true, false, (uint32_t)i});
        }
        if (i % 3000 == 0) {
            clock.now.fetch_add(SessionPublisher::kIdleGapMs + 1);  // a session ends: more messages queued
        }
    }
    stop.store(true);
    network.join();
    TEST_ASSERT_TRUE(queue.size() <= OfflineQueue::kMaxMessages);
    TEST_ASSERT_TRUE(queue.events() <= OfflineQueue::kMaxEvents);
    TEST_ASSERT_TRUE(mqtt.sent.size() > 0);
}

// the buzzer pin is reached from the loop task and from the timer task that ends a sound. Through SerialisedOutput
// the two cannot overlap: under ThreadSanitizer this finds any unguarded state
void test_the_buzzer_output_is_safe_from_the_loop_and_the_timer_task() {
    struct Pin : public BuzzerOutput {
        int level = 0;  // plain int: only safe if every call is serialised
        long changes = 0;
        void tone(uint16_t, uint8_t, uint16_t) override {
            level = 1;
            changes++;
        }
        void silence() override {
            level = 0;
            changes++;
        }
    } pin;
    MutexLock lock;
    SerialisedOutput out(pin, lock);
    AtomicClock clock;
    Buzzer buzzer(out, clock, false);
    buzzer.setSoundOn(true);
    std::atomic<bool> stop{false};
    std::thread timer([&] {  // the esp_timer task: ends sounds and asks nothing else
        while (!stop.load()) {
            out.silence();
        }
    });
    for (int i = 0; i < 20000; i++) {
        clock.now += 7;
        buzzer.request(1000, 100, 100);
        buzzer.tick();
        if (i % 50 == 0) buzzer.stop();
    }
    stop = true;
    timer.join();
    TEST_ASSERT_TRUE(pin.changes > 0);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_the_queue_and_the_status_survive_two_threads);
    RUN_TEST(test_the_buzzer_output_is_safe_from_the_loop_and_the_timer_task);
    return UNITY_END();
}
