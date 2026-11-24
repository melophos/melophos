#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "notebus.h"

namespace melophos {

// topics and payloads as docs/protocol.md and server/app/mqtt.py define them:
//   melophos/<device_id>/notes     batches of note events while playing (every 250 ms)
//   melophos/<device_id>/session   a finished practice session
//   melophos/<device_id>/status    firmware, inputs, profile and dropped events (on connect, then every 60 s)
// Every message carries boot and seq. The server accepts a message only if
// (boot, seq) is greater than the last one it kept, so a replayed message is
// refused. boot lives in flash and rises on every power-up.
enum class Kind : uint8_t { Notes, Session, Status };

// the server's rule: ^[a-z0-9][a-z0-9-]{2,63}$
bool validDeviceId(const char *id);
// writes "melophos/<id>/<kind>". Returns the length or 0 for a bad id or a small buffer
size_t topicFor(char *out, size_t cap, const char *deviceId, Kind kind);

// Unix time in seconds or 0 until the clock has been set (SNTP)
class WallClock {
   public:
    virtual ~WallClock() {}
    virtual int64_t epochSeconds() const = 0;
    // the time sessions are DATED by. It is 0 while the server says its own clock is not yet set: sessions are then
    // stamped from the uptime and dated when the server's clock is trusted. TLS date checks keep using
    // epochSeconds so the hub can still reach the server to ask again
    virtual int64_t datingSeconds() const { return epochSeconds(); }
    // true while sessions are held for a time that cannot be trusted yet (nothing is sent, dated or not)
    virtual bool holding() const { return false; }
};

class ChunkSink {
   public:
    virtual ~ChunkSink() {}
    virtual bool write(const char *data, size_t length) = 0;
};

// "2026-11-22T10:00:00Z". Returns false outside 2020 to 2100: a hub whose
// clock is wrong must not label a session with a made-up date
bool formatIso8601(int64_t epochSeconds, char out[21]);

struct StoredEvent {
    uint32_t timeMs;  // hub uptime when the note arrived
    uint8_t note;
    uint8_t velocity;
    uint8_t channel;
    uint8_t source;
};

const size_t kRefMax = 24;
const size_t kBatchMax = 32;          // events in one notes message, about 2.5 kB of JSON
const uint32_t kBatchEveryMs = 250;   // from the protocol
const uint32_t kStatusEveryMs = 60000;
const uint32_t kMaxEventMs = 6u * 3600u * 1000u;  // the server's ceiling for one session
const uint32_t kMaxSessionEvents = 49000;         // the server's ceiling is 50 000
const size_t kMaxSessionsPerHour = 120;           // the server's limit for one hub

struct QueueEntry {
    uint32_t id;  // unique in this run, given when queued: a pop can check it is still removing the same message
    Kind kind;
    uint32_t boot;
    uint32_t seq;
    char ref[kRefMax + 1];
    char profile[33];
    char mode[8];          // "melody", "rhythm", "listen", "free" or ""
    uint32_t startMono;    // uptime at the session start
    int64_t startWall;     // epoch seconds at the session start, 0 when the clock was not set yet
    uint32_t queuedMs;     // uptime when queued, for the age limit
    uint16_t eventStart;   // first event in the ring
    uint16_t eventCount;
};

// messages waiting for the broker, oldest first. The limits:
//   16 messages and 4096 events (8 bytes each: 32 kB) at once
//   anything older than 24 hours is dropped
// When full the OLDEST message goes and every loss is counted so the status
// message can report it. Held in RAM: a restart empties it (the issue does not
// ask for more and flash wear from queueing every batch would be far worse).
class OfflineQueue {
   public:
    static const size_t kMaxMessages = 16;
    static const size_t kMaxEvents = 4096;
    static const uint32_t kMaxAgeMs = 24u * 3600u * 1000u;

    // the main loop pushes and the network task pops: give both the same lock
    void setLock(Lock *lock) { lock_ = lock; }
    // events may be null when count is 0. count must be at most kBatchMax
    bool push(const QueueEntry &entry, const StoredEvent *events, size_t count, uint32_t nowMs);
    void expire(uint32_t nowMs);
    bool front(QueueEntry &out) const;
    const StoredEvent &eventAt(const QueueEntry &entry, size_t i) const { return ring_[(entry.eventStart + i) % kMaxEvents]; }
    void popFront();
    // removes the oldest message only if it is still the one with this id. False if it was dropped or replaced meanwhile
    bool popFrontIf(uint32_t id);
    // fixes the stamp of the oldest message the first time it is sent. Once set it
    // never changes: a resend after a missing acknowledgement carries the same
    // boot and seq, which is what lets the server drop the repeat
    void stampFront(uint32_t boot, uint32_t seq);
    // the same, only if the oldest message is still the one with this id. False if it is not
    bool stampFrontIf(uint32_t id, uint32_t boot, uint32_t seq);
    // gives every message that has no real start time one, worked out from how
    // long ago its session began. One call dates a whole session identically
    void resolveTimes(int64_t wallNow, uint32_t monoNow);
    size_t size() const { return count_; }
    size_t events() const { return used_; }
    uint32_t droppedMessages() const { return droppedMessages_; }
    uint32_t droppedEvents() const { return droppedEvents_; }
    void addDroppedEvents(uint32_t n) { droppedEvents_ += n; }
    // the oldest message and a copy of its events, taken under one lock so a push or a drop
    // on the other thread cannot overwrite them half way. false when the queue is empty
    bool frontWithEvents(QueueEntry &out, StoredEvent *events, size_t cap) const;
    // the events of an entry, copied under the lock (for tests and tools)
    size_t copyEvents(const QueueEntry &entry, StoredEvent *out, size_t cap) const;
    // whether any message of this session is still waiting
    // moves the date of every message not yet sent that was queued at or after sinceMs (uptime) by delta seconds
    void redate(int64_t delta, uint32_t sinceMs);
    bool hasSession(const char *ref) const;
    // copies the unsent events of a session, oldest first, into out. Returns how many
    size_t collectSession(const char *ref, StoredEvent *out, size_t cap) const;

   private:
    QueueEntry entries_[kMaxMessages];
    size_t head_ = 0;
    size_t count_ = 0;
    StoredEvent ring_[kMaxEvents];
    size_t ringHead_ = 0;  // index of the oldest stored event
    size_t used_ = 0;
    uint32_t nextId_ = 1;
    uint32_t droppedMessages_ = 0;
    uint32_t droppedEvents_ = 0;
    Lock *lock_ = &nullLock_;
    static Lock nullLock_;
    void dropOldest();
    void popFrontLocked();
};

// writes the JSON for one queued message into the sink. wallNow is the current
// epoch (0 when unset) and monoNow the uptime: together they place a session
// that began before the clock was set. Returns false when the time cannot be
// worked out yet (the message stays queued) or the sink refused.
bool encodeEntry(const QueueEntry &entry, const StoredEvent *events, int64_t wallNow, uint32_t monoNow, ChunkSink &sink);
// the same, reading the entry's events from the queue under its lock
bool encodeEntry(const OfflineQueue &queue, const QueueEntry &entry, int64_t wallNow, uint32_t monoNow, ChunkSink &sink);

// every note the hub lost before it could be published: bus overflow plus queue drops
inline uint32_t totalDropped(const NoteBus &bus, const OfflineQueue &queue) {
    return bus.dropped() + queue.droppedEvents();
}

struct StatusInfo {
    char firmware[33];   // copies, not pointers: the main loop writes and the network task reads
    char profileId[33];
    bool usbMidi, bleMidi, midiJack, audio;
    uint32_t droppedEvents;
};
bool encodeStatus(uint32_t boot, uint32_t seq, const StatusInfo &info, ChunkSink &sink);

// groups played notes into the messages above. A session starts on the first
// note and ends after a quiet gap of 2 minutes (the recorder's rule), at
// 6 hours (the server's limit) or at 49,000 events.
class SessionPublisher {
   public:
    static const uint32_t kIdleGapMs = 120000;

    // runId tells runs apart that never reached the broker, so they never share a boot: two runs must not both
    // name their first session b1-s1. It comes from the hardware random number generator
    SessionPublisher(OfflineQueue &queue, const WallClock &wall, uint32_t boot, uint32_t runId = 0) : queue_(queue), wall_(wall), boot_(boot), runId_(runId) {}
    // called when a session ends with messages still unsent: lets the caller keep them across a power cut
    class EndListener {
       public:
        virtual ~EndListener() {}
        virtual void sessionEnded(const QueueEntry &session, const StoredEvent *unsent, size_t count) = 0;
    };
    void setEndListener(EndListener *l) { endListener_ = l; }
    // an unsent session recovered after a power cut: queued again, dated by its saved start time
    void restore(const char *ref, const char *profile, const char *mode, int64_t startWall, const StoredEvent *events, size_t count, uint32_t nowMs);
    void onNote(const NoteEvent &event);
    void tick(uint32_t nowMs);
    void setProfile(const char *id);
    void setMode(const char *mode);  // "melody", "rhythm", "listen" or "free"
    bool active() const { return active_; }
    // the same for the session being recorded: its start moves when it started at or after sinceMs (uptime)
    void redate(int64_t delta, uint32_t sinceMs);
    // notes that were not recorded because 120 sessions had already started in the last hour
    uint32_t refusedSessions() const { return refusedSessions_; }

   private:
    OfflineQueue &queue_;
    const WallClock &wall_;
    uint32_t boot_;
    uint32_t runId_;
    EndListener *endListener_ = nullptr;
    uint32_t starts_[kMaxSessionsPerHour] = {};
    size_t startCount_ = 0;
    uint32_t refusedSessions_ = 0;
    uint32_t sessionCount_ = 0;
    bool active_ = false;
    char ref_[kRefMax + 1] = "";
    char profile_[33] = "piano-88";
    char mode_[8] = "free";
    uint32_t startMono_ = 0;
    int64_t startWall_ = 0;
    uint32_t lastNoteMs_ = 0;
    uint32_t lastFlushMs_ = 0;
    uint32_t sent_ = 0;
    StoredEvent pending_[kBatchMax];
    size_t pendingCount_ = 0;

    void flush(uint32_t nowMs);
    void finish(uint32_t nowMs);
    QueueEntry makeEntry(Kind kind, uint32_t nowMs);
};

}  // namespace melophos
