#include "ota_esp.h"

#include "melophos_config.h"

#ifdef MELOPHOS_ENABLE_OTA

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>

#include "kv_nvs.h"
#include "ota.h"
#include "tls_transport.h"

// the Arduino core marks a new image valid on boot unless this says otherwise:
// ours waits for the BootGuard to see a healthy minute first
extern "C" bool verifyRollbackLater() {  // extern "C": the core's weak default has C linkage, a C++ name would not replace it
    return true;
}

namespace melophos {

namespace {

class EspSlot : public FirmwareSlot {
   public:
    size_t capacity() const override {
        const esp_partition_t *p = esp_ota_get_next_update_partition(nullptr);
        return p ? p->size : 0;
    }
    bool begin(size_t size) override {
        part_ = esp_ota_get_next_update_partition(nullptr);
        return part_ != nullptr && esp_ota_begin(part_, size, &handle_) == ESP_OK && (open_ = true);
    }
    bool write(const uint8_t *data, size_t length) override { return open_ && esp_ota_write(handle_, data, length) == ESP_OK; }
    bool commit() override {
        bool ok = open_ && esp_ota_end(handle_) == ESP_OK && esp_ota_set_boot_partition(part_) == ESP_OK;
        open_ = false;
        return ok;
    }
    void abort() override {
        if (open_) {
            esp_ota_abort(handle_);
            open_ = false;
        }
    }
    bool markValid() override { return esp_ota_mark_app_valid_cancel_rollback() == ESP_OK; }
    void rollback() override { esp_ota_mark_app_invalid_rollback_and_reboot(); }

   private:
    const esp_partition_t *part_ = nullptr;
    esp_ota_handle_t handle_ = 0;
    bool open_ = false;
};

// every read has a time-out: 8 s to connect, 10 s for each read, 15 s without
// a byte ends the transfer and 10 minutes ends it whatever happens. The
// server's certificate is checked against UPDATE_CA_CERT. There is no
// setInsecure() anywhere
class HttpsFetcher : public Fetcher {
   public:
    explicit HttpsFetcher(IdentityStore &identity) : identity_(identity) {}
    bool get(const char *url, size_t maxBytes, bool (*onData)(void *, const uint8_t *, size_t), void *context) override {
        // https://host[:port]/path, already checked by isHttpsUrl
        char host[80];
        uint16_t port = 443;
        const char *p = url + 8;
        size_t n = 0;
        while (*p && *p != '/' && *p != ':' && n < sizeof host - 1) {
            host[n++] = *p++;
        }
        host[n] = '\0';
        if (*p == ':') {
            port = (uint16_t)atoi(p + 1);
            while (*p && *p != '/') {
                p++;
            }
        }
        const char *path = *p ? p : "/";
        WiFiClientSecure client;
        // the same checks as the broker: the chain, the host name, every certificate's dates and the clock
        if (secureConnect(client, identity_, host, port) != nullptr) {
            return false;
        }
        HTTPClient http;
        http.setConnectTimeout(8000);
        http.setTimeout(10000);
        http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);  // a redirect could leave the verified host
        if (!http.begin(client, host, port, path, true) || http.GET() != 200) {
            http.end();
            return false;
        }
        WiFiClient *stream = http.getStreamPtr();
        uint8_t buffer[1024];
        size_t total = 0;
        uint32_t started = millis();
        uint32_t lastByte = started;
        bool ok = true;
        while (http.connected() || stream->available() > 0) {
            int avail = stream->available();
            if (avail > 0) {
                size_t got = stream->readBytes(buffer, avail > (int)sizeof buffer ? sizeof buffer : (size_t)avail);
                total += got;
                if (total > maxBytes + 1 || !onData(context, buffer, got)) {
                    ok = false;
                    break;
                }
                lastByte = millis();
            } else if (millis() - lastByte > 15000 || millis() - started > 600000) {
                ok = false;
                break;
            } else {
                delay(1);
            }
        }
        http.end();
        return ok;
    }

   private:
    IdentityStore &identity_;
};

EspSlot slot;
NvsStore nvsStore;
IdentityStore updateIdentity(nvsStore);
HttpsFetcher fetcher(updateIdentity);
BootGuard *guard = nullptr;
const uint8_t publicKey[32] = {UPDATE_PUBKEY_BYTES};
Flash *flash = nullptr;

#if defined(CONFIG_IDF_TARGET_ESP32S3)
const uint8_t kBoard = kBoardS3;
#else
const uint8_t kBoard = kBoardBringup;
#endif

}  // namespace

void OtaService::begin(Flash &stateFlash) {
    // a signature routine that fails its known answer or a key that cannot be ours, means no updates
    if (!signatureSelfTest() || !publicKeyUsable(publicKey)) {
        Serial.println("update: the signature self-test or the built-in key failed, so updates are switched off");
        return;
    }
    flash = &stateFlash;
    static BootGuard theGuard(slot, stateFlash, 2, MELOPHOS_VERSION_NUMBER);  // sectors 0 and 1 hold the boot counter
    guard = &theGuard;
    guard->onBoot();
}

void OtaService::tick(uint32_t uptimeMs, bool healthy) {
    if (guard) {
        guard->tick(uptimeMs, healthy);
    }
}

bool OtaService::enabled() const {
    return guard != nullptr;
}

const char *OtaService::checkNow(uint32_t runningVersion) {
    if (!guard) {
        return "updates are not started";
    }
    Updater updater(slot, publicKey, kBoard);
    UpdateError e = runUpdate(updater, fetcher, UPDATE_MANIFEST_URL, UPDATE_IMAGE_URL, runningVersion, guard->floor(),
                              guard->knownBad());
    if (e != UpdateError::None) {
        return updateErrorText(e);
    }
    if (!guard->beginTrial(updater.version())) {
        return "the trial could not be recorded, so the update was not started";
    }
    ESP.restart();
    return "restarting";
}

}  // namespace melophos

#else  // updates are off

namespace melophos {

void OtaService::begin(Flash &) {}
void OtaService::tick(uint32_t, bool) {}
bool OtaService::enabled() const {
    return false;
}
const char *OtaService::checkNow(uint32_t) {
    return "updates are switched off in this build";
}

}  // namespace melophos

#endif
