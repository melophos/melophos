#include "network_esp.h"

#include <Arduino.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <esp_sntp.h>
#include <time.h>

#include <atomic>

#include <new>

#include "factoryreset.h"
#include "clockguard.h"
#include "kv_nvs.h"
#include "melophos_config.h"
#include "mqttwire.h"
#include "netctl.h"
#include "outbox.h"
#include "recordpair.h"
#include "render.h"
#include "pairing.h"
#include "provision.h"
#include "tls_transport.h"

namespace melophos {

namespace {

class ArduinoClock : public Clock {
   public:
    uint32_t nowMs() const override { return millis(); }
};

// one real SNTP reply at a time. The notification runs when the SNTP client has just set the system clock from a
// reply, so the system clock holds that reply at that moment. The value is handed to the ClockGuard from the
// network task, once per reply. The system clock is NEVER read at any other time: it would only hold the last
// reply again and a forged one would agree with itself
std::atomic<int64_t> lastReply{0};
std::atomic<uint32_t> replies{0};

void onSntpReply(struct timeval *) {
    time_t now = time(nullptr);
    lastReply = now > 0 ? (int64_t)now : 0;
    replies++;
}

class MutexLock : public Lock {
   public:
    MutexLock() : handle_(xSemaphoreCreateMutex()) {}
    void lock() override { xSemaphoreTake(handle_, portMAX_DELAY); }
    void unlock() override { xSemaphoreGive(handle_); }

   private:
    SemaphoreHandle_t handle_;
};

ArduinoClock appClock;
MutexLock clockLock;
ClockGuard wall(appClock, buildEpochFrom(__DATE__, __TIME__), &clockLock);
NvsStore nvs;
IdentityStore identity(nvs);
TlsTransport transport(identity);
HttpsApi httpsApi(identity);
PairingFsm pairing(appClock, httpsApi, identity, wall);
void sayTime(const char *line);
OfflineQueue &queue = *new OfflineQueue();  // 36 kB: on the heap, since static data of that size does not fit the classic ESP32
MutexLock queueLock;
MutexLock statusLock;
SessionPublisher *publisher = nullptr;
ClockSync *clockSync = nullptr;
void sayTime(const char *line) {
    Serial.println(line);
}
Outbox *outbox = nullptr;
NoteBus *noteBus = nullptr;
NetworkController *controller = nullptr;
volatile bool wifiStarted = false;
char restoredRef[kRefMax + 1] = "";
// written by the main loop, copied by the network task, both under statusLock
StatusInfo sharedStatus{"", "", false, false, false, false, 0};

void startWifi() {
    char ssid[40], pass[70];
    if (wifiStarted || !identity.wifi(ssid, sizeof ssid, pass, sizeof pass)) {
        return;
    }
    WiFi.persistent(false);  // the driver must not keep its own copy of the password in its store
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid, pass);
    // plain SNTP, unauthenticated: see docs/mqtt.md for what that allows. Until a time is believed the client asks
    // every 35 s so that separate replies can agree within a couple of minutes. Afterwards once an hour
    sntp_set_time_sync_notification_cb(onSntpReply);
    sntp_set_sync_interval(35000);
    configTime(0, 0, "pool.ntp.org");
    wifiStarted = true;
}

// the board side of the network task. The task owns the link: it alone builds and frees it
class EspPlatform : public NetPlatform {
   public:
    void say(const char *line) override { Serial.println(line); }
    MqttLink *openLink(const char *host, uint16_t port, const char *id, const char *secret, uint32_t boot, BootCommit *commit) override {
        strncpy(host_, host, sizeof host_ - 1);
        strncpy(id_, id, sizeof id_ - 1);
        strncpy(secret_, secret, sizeof secret_ - 1);
        brokerPassword(secret_, password_);  // the broker never sees the device secret
        config_ = deviceConfig(host_, port, id_, password_);
        wire_ = new MqttWireClient(appClock, transport, config_);
        link_ = new MqttLink(appClock, *wire_, queue, wall, id_, boot);
        link_->setBootCommit(commit);
        return link_;
    }
    void closeLink(MqttLink *link) override {
        if (link == link_) {
            delete link_;
            delete wire_;
            link_ = nullptr;
            wire_ = nullptr;
        }
    }
    StatusInfo status() override {
        statusLock.lock();
        StatusInfo copy = sharedStatus;
        statusLock.unlock();
        return copy;
    }

   private:
    char host_[80] = "", id_[70] = "", secret_[70] = "", password_[65] = "";
    MqttWireConfig config_{};
    MqttWireClient *wire_ = nullptr;
    MqttLink *link_ = nullptr;
};

EspPlatform platform;

void networkTask(void *) {
    for (;;) {
        startWifi();
        static uint32_t seenReplies = 0;
        uint32_t n = replies.load();
        if (n != seenReplies) {  // a real SNTP reply arrived
            seenReplies = n;
            wall.offer(lastReply.load());
            if (wall.trusted() && !wall.pending()) {
                sntp_set_sync_interval(3600000);
            }
        }
        controller->step(WiFi.status() == WL_CONNECTED);
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

}  // namespace

int64_t trustedWallNow() {
    return wall.epochSeconds();
}

void Network::begin(NoteBus &bus, Flash &stateFlash, Flash &outboxFlash) {
    noteBus = &bus;
    static DurableCounter counter(stateFlash, 0, 1, 0x544F4F42);
    static NetworkController theController(appClock, identity, pairing, platform, counter);
    controller = &theController;
    static ClockSync theSync(wall, queue, nullptr, sayTime, &clockLock);  // the session is the main task's: it re-dates on its own pass
    clockSync = &theSync;
    pairing.setTimeSink(clockSync);
    controller->begin();  // reads the boot counter. It is written when the broker first accepts the hub
    queue.setLock(&queueLock);
    static SessionPublisher thePublisher(queue, wall, controller->bootNumber(), esp_random() | 1u);  // a run id: runs that never connect share a boot
    static Outbox theOutbox(outboxFlash, 0, &appClock);
    publisher = &thePublisher;
    outbox = &theOutbox;
    publisher->setEndListener(outbox);
    // a session that was not delivered before the last power cut goes out now
    Outbox::Saved *saved = new (std::nothrow) Outbox::Saved();
    if (saved != nullptr && outbox->load(*saved)) {
        publisher->restore(saved->ref, saved->profile, saved->mode, saved->startWall, saved->events, saved->count, millis());
        strncpy(restoredRef, saved->ref, kRefMax);
        Serial.printf("outbox: restored session %s with %u unsent events\n", saved->ref, (unsigned)saved->count);
    }
    delete saved;
    xTaskCreate(networkTask, "network", 10240, nullptr, 1, nullptr);
}

void Network::poll() {
    if (publisher == nullptr) {
        return;
    }
    int64_t delta;
    uint32_t since;
    if (clockSync != nullptr && clockSync->takeSessionRedate(delta, since)) {
        publisher->redate(delta, since);  // dates taken from a wrong clock move to the server's
    }
    publisher->tick(millis());
    if (restoredRef[0] != '\0' && !queue.hasSession(restoredRef)) {
        outbox->markDelivered();  // the saved copy is not needed any more
        restoredRef[0] = '\0';
    }
}

void Network::onNote(const NoteEvent &event) {
    if (publisher) {
        publisher->onNote(event);
    }
}

void Network::setContext(const char *profileId, const char *mode, const StatusInfo &inputs) {
    if (publisher == nullptr) {
        return;
    }
    publisher->setProfile(profileId);
    publisher->setMode(mode);
    StatusInfo info = inputs;
    strncpy(info.profileId, profileId, sizeof info.profileId - 1);
    info.profileId[sizeof info.profileId - 1] = '\0';
    info.droppedEvents = totalDropped(*noteBus, queue);
    statusLock.lock();
    sharedStatus = info;
    statusLock.unlock();
}

bool Network::provision(const char *line, size_t length, char *reply, size_t cap) {
    return handleProvisionCommand(identity, line, length, reply, cap);
}

void Network::forgetEverything() {
    identity.clearAll();
    WiFi.disconnect(true, true);  // and the Wi-Fi driver's own saved copy of the network
}

bool Network::factoryReset(Flash &profiles, Flash &outbox) {
    bool ok = ::melophos::factoryReset(identity, profiles, outbox);
    WiFi.disconnect(true, true);
    return ok;
}

bool Network::configured() {
    return controller != nullptr && controller->configured();
}

uint16_t Network::supplyMa() {
    return identity.supplyMa();
}

bool Network::bootLost() const {
    return controller != nullptr && controller->bootLost();
}

void Network::clearStale() {
    if (controller != nullptr) {
        controller->requestClearStale();
    }
}

uint16_t Network::auxLength() {
    return identity.auxLength((uint16_t)kAuxLedsMax, (uint16_t)kAuxLedsDefault);
}

bool Network::setAuxLength(uint16_t length, const char **why) {
    return identity.setAuxLength(length, (uint16_t)kAuxLedsMax, why);
}

bool Network::soundOn() {
    return identity.soundOn();
}

bool Network::setSoundOn(bool on) {
    return identity.setSoundOn(on);
}

void Network::unclaim() {
    if (controller != nullptr) {
        controller->requestUnclaim();
    }
}

bool Network::everConnected() const {
    return controller != nullptr && controller->everConnected();
}

bool Network::insecure() {
    return identity.insecure();
}

const char *Network::pairingCode() const {
    return pairing.code();
}

}  // namespace melophos
