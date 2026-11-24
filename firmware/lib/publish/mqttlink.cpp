#include "mqttlink.h"

namespace melophos {

namespace {

class BufferSink : public ChunkSink {
   public:
    BufferSink(uint8_t *buf, size_t cap) : buf_(buf), cap_(cap) {}
    size_t length = 0;
    bool write(const char *d, size_t n) override {
        if (length + n > cap_) {
            return false;  // too big to send
        }
        memcpy(buf_ + length, d, n);
        length += n;
        return true;
    }

   private:
    uint8_t *buf_;
    size_t cap_;
};

}  // namespace

void MqttLink::failed() {
    failures_++;
    client_.disconnect();
    inflight_ = 0;
    nextAttemptMs_ = clock_.nowMs() + backoffMs_;
    backoffMs_ = backoffMs_ * 2 > kBackoffMaxMs ? kBackoffMaxMs : backoffMs_ * 2;
}

bool MqttLink::sendStatus() {
    char topic[96];
    if (topicFor(topic, sizeof topic, deviceId_, Kind::Status) == 0) {
        return false;
    }
    StatusInfo info;
    {
        LockGuard g(*statusLock_);
        info = status_;
    }
    BufferSink out(payload_, sizeof payload_);
    if (!encodeStatus(boot_, seq_[(int)Kind::Status] + 1, info, out)) {
        return false;
    }
    if (client_.publish(topic, payload_, out.length, false) < 0) {
        return false;
    }
    seq_[(int)Kind::Status]++;  // status is live data: the next one replaces a lost one
    return true;
}

bool MqttLink::isStale(const QueueEntry &e) const {
    int64_t nowWall = wall_.datingSeconds();
    return nowWall != 0 && e.startWall != 0 && (e.startWall < nowWall - kMaxPastS || e.startWall > nowWall + kMaxFutureS);
}

uint32_t MqttLink::clearStale() {
    uint32_t n = 0;
    QueueEntry e;
    while (queue_.front(e) && isStale(e)) {
        if (!queue_.popFrontIf(e.id)) {
            break;
        }
        n++;
    }
    holdingStale_ = false;
    return n;
}

bool MqttLink::sendFront() {
    QueueEntry e;
    if (!queue_.front(e)) {
        return true;
    }
    char topic[96];
    size_t t = topicFor(topic, sizeof topic, deviceId_, e.kind);
    if (t == 0) {
        if (queue_.popFrontIf(e.id)) {  // only the message that was looked at, not whatever is first now
            refused_++;
        }
        return true;
    }
    if (wall_.holding()) {
        return true;  // the server's own clock is not set yet: every session waits, dated or not
    }
    if (e.startWall == 0) {
        return true;  // no real time yet: it waits and a made-up date is never sent
    }
    holdingStale_ = isStale(e);
    if (holdingStale_) {
        // the server skips a start time more than 366 days back or a day ahead. The hub does not throw the
        // session away for that: the clock may be what is wrong. It waits here until the time is believed
        // differently or a person clears it
        return true;
    }
    if (e.seq == 0) {
        // the first time this message is sent: its stamp is fixed here and never changes again
        uint32_t next = seq_[(int)e.kind] + 1;
        if (!queue_.stampFrontIf(e.id, boot_, next)) {
            return true;  // the front changed under us: look again on the next pass, nothing is stamped
        }
        seq_[(int)e.kind] = next;
    } else {
        resends_++;
    }
    BufferSink out(payload_, sizeof payload_);
    StoredEvent events[kBatchMax];
    const uint32_t entryId = e.id;
    if (!queue_.frontWithEvents(e, events, kBatchMax) || e.id != entryId || e.seq == 0) {
        return true;  // the queue changed under us: nothing is sent or removed, the next pass looks again
    }
    if (!encodeEntry(e, events, 0, 0, out)) {
        if (queue_.popFrontIf(e.id)) {  // cannot be encoded or is too large: it must not block the rest
            refused_++;
        }
        return true;
    }
    int id = client_.publish(topic, payload_, out.length, true);
    if (id <= 0) {
        return false;
    }
    inflight_ = id;
    inflightId_ = e.id;
    inflightSinceMs_ = clock_.nowMs();
    return true;
}

void MqttLink::pump() {
    uint32_t now = clock_.nowMs();
    if (inflight_ == 0) {
        queue_.expire(now);
    }
    queue_.resolveTimes(wall_.datingSeconds(), now);
    if (!client_.connected()) {
        if ((int32_t)(now - nextAttemptMs_) < 0) {
            return;
        }
        attempts_++;
        inflight_ = 0;
        if (!client_.connect()) {
            int why = client_.refusal();
            loginRefusals_ = (why == 4 || why == 5) ? loginRefusals_ + 1 : 0;
            failed();
            if (why == 4 || why == 5) {
                // a refused login is not a network hiccup: no retry for a minute whatever the back-off was
                nextAttemptMs_ = clock_.nowMs() + kRefusedRetryMs;
            }
            return;
        }
        loginRefusals_ = 0;
        if (commit_ != nullptr && !committed_) {
            // the boot number is stored before the first message of this run goes out, so a crash cannot reuse it
            if (!commit_->commit(boot_)) {
                client_.disconnect();
                failures_++;
                nextAttemptMs_ = clock_.nowMs() + backoffMs_;
                return;
            }
            committed_ = true;
        }
        backoffMs_ = kBackoffStartMs;
        everConnected_ = true;
        statusDue_ = true;  // status goes out on every connect
    }
    client_.service();
    if (!client_.connected()) {
        failed();
        return;
    }
    int acked;
    while (client_.pollAck(acked)) {
        // the queue may have dropped the oldest message meanwhile: only pop the one that was acknowledged
        if (inflight_ != 0 && acked == inflight_) {
            queue_.popFrontIf(inflightId_);  // only now and only that message: the broker has it
        }
        if (acked == inflight_) {
            inflight_ = 0;
        }
    }
    if (inflight_ != 0 && (uint32_t)(now - inflightSinceMs_) >= kAckTimeoutMs) {
        failed();  // no PUBACK: reconnect and send the same message again
        return;
    }
    if (statusDue_ || (uint32_t)(now - lastStatusMs_) >= kStatusEveryMs) {
        if (!sendStatus()) {
            failed();
            return;
        }
        statusDue_ = false;
        lastStatusMs_ = now;
    }
    if (inflight_ == 0 && !sendFront()) {
        failed();
    }
}

}  // namespace melophos
