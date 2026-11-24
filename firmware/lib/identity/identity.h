#pragma once

#include <stddef.h>
#include <stdint.h>

namespace melophos {

// where the hub keeps what makes it THIS hub. The real store is NVS. None of
// it is ever compiled into the firmware or committed.
class KeyValueStore {
   public:
    virtual ~KeyValueStore() {}
    virtual bool get(const char *key, char *out, size_t cap, size_t &length) = 0;
    virtual bool put(const char *key, const char *value, size_t length) = 0;
    virtual bool erase(const char *key) = 0;
};

namespace idlimits {
const size_t kSsid = 32;
const size_t kWifiPassword = 63;
const size_t kHost = 63;
const size_t kDeviceId = 64;
const size_t kSecret = 64;
const size_t kCa = 3000;  // a PEM chain of two certificates fits
}  // namespace idlimits

// everything is checked on the way in and again on the way out.
//   wifi     ssid 1 to 32 and password 0 or 8 to 63 printable characters
//   broker   host name or address and a port 1 to 65535
//   device   the id and secret the pairing flow hands out
//   ca       a PEM certificate or chain the owner provisions
//   insecure an explicit flag that lets the hub talk to the broker without TLS.
//            In a release build its command is not recognised and the store refuses it
class IdentityStore {
   public:
    explicit IdentityStore(KeyValueStore &kv) : kv_(kv) {}

    bool setWifi(const char *ssid, const char *password, const char **why);
    bool setBroker(const char *host, long port, const char **why);
    // the server's HTTPS address for pairing (host and port, 443 by default)
    bool setApi(const char *host, long port, const char **why);
    bool setDevice(const char *id, const char *secret, const char **why);
    bool setCa(const char *pem, size_t length, const char **why);
    // refused in a release build
    bool setInsecure(bool on, const char **why);

    bool wifi(char *ssid, size_t ssidCap, char *password, size_t passCap);
    bool broker(char *host, size_t cap, uint16_t &port);
    bool api(char *host, size_t cap, uint16_t &port);
    bool device(char *id, size_t idCap, char *secret, size_t secretCap);
    // returns the length, 0 when none
    size_t ca(char *out, size_t cap);
    bool hasCa();
    bool insecure();
    // the stored sound setting: OFF unless turned on. A buzzer nobody asked for is a fault, so nothing sounds by default.
    // Cleared by a factory reset
    // the length in use of the third LED output: a stored setting. maxLeds is the hard maximum the hub supports. A
    // length over it is refused and so is a write that fails or does not read back. `fallback` is returned when
    // nothing is stored or what is stored is over the maximum
    uint16_t auxLength(uint16_t maxLeds, uint16_t fallback);
    bool setAuxLength(uint16_t length, uint16_t maxLeds, const char **why);
    bool soundOn();
    bool setSoundOn(bool on);

    // enough to connect over TLS: Wi-Fi, a broker, a device login and a CA
    bool readyForTls();
    bool readyInsecure();

    // the supply adapter's rating in mA, from 2500 to 6000. Unset means the board's own 5 A supply
    bool setSupplyMa(long ma, const char **why);
    uint16_t supplyMa();

    // pairing progress, kept so a restart carries on where it was
    bool setPaired(bool on);
    bool paired();
    bool setPairingCode(const char *code);
    bool pairingCode(char *out, size_t cap);

    // identity requests in the current hour, kept so a restart cannot reset the server's limit of 20 an hour
    bool setPairWindow(int64_t startEpoch, uint32_t count);
    bool pairWindow(int64_t &startEpoch, uint32_t &count);

    // forget who this hub is: the device id and secret. Pairing starts again
    void clearDevice();
    // forget everything provisioned: Wi-Fi, broker, device, CA and the insecure flag
    void clearAll();

   private:
    KeyValueStore &kv_;
};

// plain MQTT's port. TLS is on 8883. A TLS connection to 1883 is refused: that port is the
// development listener and the hub must not fall back to it
const uint16_t kPlainMqttPort = 1883;
const uint16_t kTlsMqttPort = 8883;

bool validPem(const char *pem, size_t length);
// standard base64 decode into out. Returns the decoded length or 0 when the text is not valid
size_t base64Decode(const char *in, size_t length, uint8_t *out, size_t cap);

}  // namespace melophos
