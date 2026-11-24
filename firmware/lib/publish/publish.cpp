#include "publish.h"

#include <stdio.h>
#include <new>
#include <string.h>

namespace melophos {

bool validDeviceId(const char *id) {
    if (id == nullptr) {
        return false;
    }
    size_t n = strlen(id);
    if (n < 3 || n > 64) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        char c = id[i];
        bool alnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        if (!(alnum || (c == '-' && i > 0))) {
            return false;
        }
    }
    return true;
}

size_t topicFor(char *out, size_t cap, const char *deviceId, Kind kind) {
    if (!validDeviceId(deviceId) || (uint8_t)kind > (uint8_t)Kind::Status) {
        return 0;  // a kind that is not one of the three would index the sequence table out of bounds
    }
    const char *k = kind == Kind::Notes ? "notes" : kind == Kind::Session ? "session" : "status";
    int n = snprintf(out, cap, "melophos/%s/%s", deviceId, k);
    return (n > 0 && (size_t)n < cap) ? (size_t)n : 0;
}

bool formatIso8601(int64_t t, char out[21]) {
    if (t < 1577836800 || t >= 4102444800) {  // 2020-01-01 to 2100-01-01
        return false;
    }
    int64_t days = t / 86400;
    int64_t rem = t % 86400;
    // civil from days (proleptic Gregorian), after Howard Hinnant
    days += 719468;
    int64_t era = days / 146097;
    int64_t doe = days - era * 146097;
    int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    int64_t y = yoe + era * 400;
    int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    int64_t mp = (5 * doy + 2) / 153;
    int64_t d = doy - (153 * mp + 2) / 5 + 1;
    int64_t m = mp < 10 ? mp + 3 : mp - 9;
    if (m <= 2) {
        y++;
    }
    // the range check above bounds every field, but the compiler cannot see through the date arithmetic: a wide
    // scratch buffer keeps the build free of truncation warnings without changing the 20 characters written
    char tmp[64];
    snprintf(tmp, sizeof tmp, "%04d-%02d-%02dT%02d:%02d:%02dZ", (int)y, (int)m, (int)d, (int)(rem / 3600), (int)(rem % 3600 / 60),
             (int)(rem % 60));
    memcpy(out, tmp, 20);
    out[20] = '\0';
    return true;
}

// ---------- queue ----------

Lock OfflineQueue::nullLock_;

void OfflineQueue::dropOldest() {
    if (count_ == 0) {
        return;
    }
    droppedMessages_++;
    droppedEvents_ += entries_[head_].eventCount;
    popFrontLocked();
}

bool OfflineQueue::popFrontIf(uint32_t id) {
    LockGuard g(*lock_);
    if (count_ == 0 || entries_[head_].id != id) {
        return false;
    }
    popFrontLocked();
    return true;
}

void OfflineQueue::popFront() {
    LockGuard g(*lock_);
    popFrontLocked();
}

void OfflineQueue::popFrontLocked() {
    if (count_ == 0) {
        return;
    }
    size_t n = entries_[head_].eventCount;
    ringHead_ = (ringHead_ + n) % kMaxEvents;
    used_ -= n;
    head_ = (head_ + 1) % kMaxMessages;
    count_--;
}

bool OfflineQueue::push(const QueueEntry &entry, const StoredEvent *events, size_t count, uint32_t nowMs) {
    if (count > kBatchMax || (count > 0 && events == nullptr)) {
        return false;
    }
    LockGuard g(*lock_);
    while (count_ > 0 && (uint32_t)(nowMs - entries_[head_].queuedMs) > kMaxAgeMs) {
        dropOldest();
    }
    while (count_ == kMaxMessages || used_ + count > kMaxEvents) {
        dropOldest();
    }
    QueueEntry &slot = entries_[(head_ + count_) % kMaxMessages];
    slot = entry;
    slot.id = nextId_++;
    slot.queuedMs = nowMs;
    slot.eventStart = (uint16_t)((ringHead_ + used_) % kMaxEvents);
    slot.eventCount = (uint16_t)count;
    for (size_t i = 0; i < count; i++) {
        ring_[(slot.eventStart + i) % kMaxEvents] = events[i];
    }
    used_ += count;
    count_++;
    return true;
}

void OfflineQueue::expire(uint32_t nowMs) {
    LockGuard g(*lock_);
    while (count_ > 0 && (uint32_t)(nowMs - entries_[head_].queuedMs) > kMaxAgeMs) {
        dropOldest();
    }
}

bool OfflineQueue::front(QueueEntry &out) const {
    LockGuard g(*lock_);
    if (count_ == 0) {
        return false;
    }
    out = entries_[head_];
    return true;
}

void OfflineQueue::stampFront(uint32_t boot, uint32_t seq) {
    LockGuard g(*lock_);
    if (count_ > 0 && entries_[head_].seq == 0) {
        entries_[head_].boot = boot;
        entries_[head_].seq = seq;
    }
}

bool OfflineQueue::stampFrontIf(uint32_t id, uint32_t boot, uint32_t seq) {
    LockGuard g(*lock_);
    if (count_ == 0 || entries_[head_].id != id) {
        return false;
    }
    if (entries_[head_].seq == 0) {
        entries_[head_].boot = boot;
        entries_[head_].seq = seq;
    }
    return true;
}

void OfflineQueue::redate(int64_t delta, uint32_t sinceMs) {
    LockGuard g(*lock_);
    for (size_t i = 0; i < count_; i++) {
        QueueEntry &e = entries_[(head_ + i) % kMaxMessages];
        if (e.startWall != 0 && e.seq == 0 && (int32_t)(e.queuedMs - sinceMs) >= 0) {
            e.startWall += delta;
        }
    }
}

void SessionPublisher::redate(int64_t delta, uint32_t sinceMs) {
    if (active_ && startWall_ != 0 && (int32_t)(startMono_ - sinceMs) >= 0) {
        startWall_ += delta;
    }
}

void OfflineQueue::resolveTimes(int64_t wallNow, uint32_t monoNow) {
    if (wallNow == 0) {
        return;
    }
    LockGuard g(*lock_);
    for (size_t i = 0; i < count_; i++) {
        QueueEntry &e = entries_[(head_ + i) % kMaxMessages];
        if (e.startWall == 0) {
            e.startWall = wallNow - (int64_t)((uint32_t)(monoNow - e.startMono) / 1000u);
        }
    }
}

bool OfflineQueue::frontWithEvents(QueueEntry &out, StoredEvent *events, size_t cap) const {
    LockGuard g(*lock_);
    if (count_ == 0) {
        return false;
    }
    out = entries_[head_];
    for (size_t i = 0; i < out.eventCount && i < cap; i++) {
        events[i] = ring_[(out.eventStart + i) % kMaxEvents];
    }
    return true;
}

size_t OfflineQueue::copyEvents(const QueueEntry &entry, StoredEvent *out, size_t cap) const {
    LockGuard g(*lock_);
    size_t n = 0;
    for (size_t i = 0; i < entry.eventCount && n < cap; i++) {
        out[n++] = ring_[(entry.eventStart + i) % kMaxEvents];
    }
    return n;
}

bool OfflineQueue::hasSession(const char *ref) const {
    LockGuard g(*lock_);
    for (size_t i = 0; i < count_; i++) {
        if (!strcmp(entries_[(head_ + i) % kMaxMessages].ref, ref)) {
            return true;
        }
    }
    return false;
}

size_t OfflineQueue::collectSession(const char *ref, StoredEvent *out, size_t cap) const {
    LockGuard g(*lock_);
    size_t n = 0;
    for (size_t i = 0; i < count_; i++) {
        const QueueEntry &e = entries_[(head_ + i) % kMaxMessages];
        if (strcmp(e.ref, ref) != 0) {
            continue;
        }
        for (size_t k = 0; k < e.eventCount && n < cap; k++) {
            out[n++] = ring_[(e.eventStart + k) % kMaxEvents];
        }
    }
    return n;
}

// ---------- encoding ----------

namespace {

// batches small writes so the radio sees a few hundred bytes at a time
class Chunked {
   public:
    explicit Chunked(ChunkSink &sink) : sink_(sink) {}
    void raw(const char *s) {
        size_t n = strlen(s);
        while (n > 0 && ok_) {
            size_t room = sizeof buf_ - used_;
            size_t take = n < room ? n : room;
            memcpy(buf_ + used_, s, take);
            used_ += take;
            s += take;
            n -= take;
            if (used_ == sizeof buf_) {
                flush();
            }
        }
    }
    void str(const char *s) {
        raw("\"");
        for (; *s; s++) {
            char c[7];
            unsigned char u = (unsigned char)*s;
            if (u == '"' || u == '\\') {
                snprintf(c, sizeof c, "\\%c", u);
            } else if (u < 0x20) {
                snprintf(c, sizeof c, "\\u%04x", u);
            } else {
                c[0] = (char)u;
                c[1] = 0;
            }
            raw(c);
        }
        raw("\"");
    }
    void num(long long v) {
        char t[24];
        snprintf(t, sizeof t, "%lld", v);
        raw(t);
    }
    bool finish() {
        flush();
        return ok_;
    }

   private:
    void flush() {
        if (used_ && ok_) {
            ok_ = sink_.write(buf_, used_);
        }
        used_ = 0;
    }
    ChunkSink &sink_;
    char buf_[96];
    size_t used_ = 0;
    bool ok_ = true;
};

const char *sourceName(uint8_t s) {
    switch ((NoteSource)s) {
        case NoteSource::UsbMidi:
            return "usb_midi";
        case NoteSource::BleMidi:
            return "ble_midi";
        case NoteSource::MidiJack:
            return "midi_jack";
        case NoteSource::Audio:
            return "audio";
        default:
            return "network";
    }
}

void stamp(Chunked &j, uint32_t boot, uint32_t seq) {
    j.raw("{\"boot\":");
    j.num(boot);
    j.raw(",\"seq\":");
    j.num(seq);
}

}  // namespace

bool encodeEntry(const OfflineQueue &queue, const QueueEntry &e, int64_t wallNow, uint32_t monoNow, ChunkSink &sink) {
    StoredEvent events[kBatchMax];
    queue.copyEvents(e, events, kBatchMax);
    return encodeEntry(e, events, wallNow, monoNow, sink);
}

bool encodeEntry(const QueueEntry &e, const StoredEvent *events, int64_t wallNow, uint32_t monoNow, ChunkSink &sink) {
    (void)wallNow;
    (void)monoNow;
    int64_t start = e.startWall;
    if (start == 0 || e.seq == 0) {
        return false;  // not dated or not stamped yet: a message is never built from a guess
    }
    char iso[21];
    if (!formatIso8601(start, iso)) {
        return false;
    }
    Chunked j(sink);
    stamp(j, e.boot, e.seq);
    j.raw(",\"session_ref\":");
    j.str(e.ref);
    j.raw(",\"started_at\":");
    j.str(iso);
    j.raw(",\"profile_id\":");
    j.str(e.profile);
    if (e.kind == Kind::Session) {
        if (e.mode[0]) {
            j.raw(",\"mode\":");
            j.str(e.mode);
        }
        j.raw(",\"events\":[]}");
        return j.finish();
    }
    j.raw(",\"events\":[");
    for (size_t i = 0; i < e.eventCount; i++) {
        const StoredEvent &ev = events[i];
        if (i) {
            j.raw(",");
        }
        j.raw("{\"t_ms\":");
        uint32_t t = ev.timeMs - e.startMono;
        j.num(t > kMaxEventMs ? kMaxEventMs : t);
        j.raw(",\"note\":");
        j.num(ev.note);
        j.raw(",\"velocity\":");
        j.num(ev.velocity);
        j.raw(",\"channel\":");
        j.num(ev.channel);
        j.raw(",\"source\":");
        j.str(sourceName(ev.source));
        j.raw("}");
    }
    j.raw("]}");
    return j.finish();
}

bool encodeStatus(uint32_t boot, uint32_t seq, const StatusInfo &s, ChunkSink &sink) {
    Chunked j(sink);
    stamp(j, boot, seq);
    j.raw(",\"firmware\":");
    j.str(s.firmware);
    if (s.profileId[0]) {
        j.raw(",\"profile_id\":");
        j.str(s.profileId);
    }
    j.raw(",\"inputs\":[");
    bool first = true;
    auto add = [&](bool on, const char *name) {
        if (on) {
            if (!first) {
                j.raw(",");
            }
            j.str(name);
            first = false;
        }
    };
    add(s.usbMidi, "usb_midi");
    add(s.bleMidi, "ble_midi");
    add(s.midiJack, "midi_jack");
    add(s.audio, "audio");
    j.raw("],\"dropped_events\":");
    j.num(s.droppedEvents);
    j.raw("}");
    return j.finish();
}

// ---------- session publisher ----------

void SessionPublisher::setProfile(const char *id) {
    if (id && strlen(id) <= 32 && id[0]) {
        strcpy(profile_, id);
    }
}

void SessionPublisher::setMode(const char *mode) {
    if (mode && (!strcmp(mode, "melody") || !strcmp(mode, "rhythm") || !strcmp(mode, "listen") || !strcmp(mode, "free"))) {
        strcpy(mode_, mode);
    }
}

QueueEntry SessionPublisher::makeEntry(Kind kind, uint32_t nowMs) {
    QueueEntry e{};
    e.kind = kind;
    e.boot = 0;  // boot and seq are fixed when the message is first sent
    e.seq = 0;
    strcpy(e.ref, ref_);
    strcpy(e.profile, profile_);
    strcpy(e.mode, mode_);
    e.startMono = startMono_;
    e.startWall = startWall_;
    e.queuedMs = nowMs;
    return e;
}

void SessionPublisher::flush(uint32_t nowMs) {
    if (pendingCount_ == 0) {
        return;
    }
    queue_.push(makeEntry(Kind::Notes, nowMs), pending_, pendingCount_, nowMs);
    sent_ += (uint32_t)pendingCount_;
    pendingCount_ = 0;
    lastFlushMs_ = nowMs;
}

void SessionPublisher::finish(uint32_t nowMs) {
    flush(nowMs);
    QueueEntry session = makeEntry(Kind::Session, nowMs);
    queue_.push(session, nullptr, 0, nowMs);
    active_ = false;
    if (endListener_) {
        // what is still unsent now would be lost to a power cut: the listener may keep it
        // on the heap for the length of the call: 8 kB is too much to hold as static data on the classic ESP32
        StoredEvent *unsent = new (std::nothrow) StoredEvent[1000];
        if (unsent != nullptr) {
            size_t n = queue_.collectSession(ref_, unsent, 1000);
            session.startWall = startWall_;
            endListener_->sessionEnded(session, unsent, n);
            delete[] unsent;
        }
    }
}

void SessionPublisher::restore(const char *ref, const char *profile, const char *mode, int64_t startWall,
                               const StoredEvent *events, size_t count, uint32_t nowMs) {
    QueueEntry e{};
    e.kind = Kind::Notes;
    strncpy(e.ref, ref, kRefMax);
    strncpy(e.profile, profile, 32);
    strncpy(e.mode, mode, 7);
    e.startWall = startWall;
    e.startMono = 0;  // the saved events carry their offset from the session start, not a time on this boot's clock
    for (size_t at = 0; at < count; at += kBatchMax) {
        queue_.push(e, events + at, count - at < kBatchMax ? count - at : kBatchMax, nowMs);
    }
    e.kind = Kind::Session;
    queue_.push(e, nullptr, 0, nowMs);
}

void SessionPublisher::onNote(const NoteEvent &event) {
    if (active_ && (uint32_t)(event.timeMs - startMono_) >= kMaxEventMs - 1000) {
        finish(event.timeMs);
    }
    if (active_ && sent_ + pendingCount_ >= kMaxSessionEvents) {
        finish(event.timeMs);
    }
    if (!active_) {
        if (event.velocity == 0) {
            return;  // a release with no session open is a leftover from the last one
        }
        // the server takes at most 120 new sessions an hour from a hub: the 121st is not started
        size_t recent = 0;
        for (size_t i = 0; i < startCount_; i++) {
            recent += (uint32_t)(event.timeMs - starts_[i]) < 3600000u;
        }
        if (recent >= kMaxSessionsPerHour) {
            refusedSessions_++;
            return;
        }
        if (startCount_ == kMaxSessionsPerHour) {
            memmove(starts_, starts_ + 1, sizeof(uint32_t) * (kMaxSessionsPerHour - 1));
            startCount_--;
        }
        starts_[startCount_++] = event.timeMs;
        active_ = true;
        sessionCount_++;
        if (runId_ == 0) {
            snprintf(ref_, sizeof ref_, "b%lu-s%lu", (unsigned long)boot_, (unsigned long)sessionCount_);
        } else {
            // a wide scratch buffer, then a bounded copy: the reference is cut to its capacity exactly as before
            char tmp[48];
            snprintf(tmp, sizeof tmp, "b%lu-%08lx-s%lu", (unsigned long)boot_, (unsigned long)runId_, (unsigned long)sessionCount_);
            memcpy(ref_, tmp, sizeof ref_ - 1);
            ref_[sizeof ref_ - 1] = '\0';
        }
        startMono_ = event.timeMs;
        startWall_ = wall_.datingSeconds();
        sent_ = 0;
        pendingCount_ = 0;
        lastFlushMs_ = event.timeMs;
    }
    lastNoteMs_ = event.timeMs;
    if (pendingCount_ == kBatchMax) {
        flush(event.timeMs);
    }
    pending_[pendingCount_++] = StoredEvent{event.timeMs, event.note, event.velocity, event.channel, (uint8_t)event.source};
}

void SessionPublisher::tick(uint32_t nowMs) {
    // the clock may have been set since: date every session that has no date yet
    queue_.resolveTimes(wall_.datingSeconds(), nowMs);
    if (startWall_ == 0 && active_) {
        int64_t w = wall_.datingSeconds();
        if (w != 0) {
            startWall_ = w - (int64_t)((uint32_t)(nowMs - startMono_) / 1000u);
        }
    }
    if (!active_) {
        return;
    }
    if (pendingCount_ > 0 && (uint32_t)(nowMs - lastFlushMs_) >= kBatchEveryMs) {
        flush(nowMs);
    }
    if ((uint32_t)(nowMs - lastNoteMs_) > kIdleGapMs) {
        finish(nowMs);
    }
}

}  // namespace melophos
