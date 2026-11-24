#include "ble_midi_esp.h"

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include "kv_nvs.h"

namespace melophos {

namespace {

const char *kServiceUuid = "03B80E5A-EDE8-4B33-A751-6CE34EC4C700";
const char *kCharacteristicUuid = "7772E5DB-3868-4112-A1A9-F2669D106BF3";

// the radio callbacks run on the NimBLE task. They only queue what happened:
// the main loop applies it, so the link state and the guide lights keep one
// thread of control
enum class Evt : uint8_t { Connect, Disconnect, Subscribe, Unsubscribe, Data, Encrypted, PairingOpen, Accept };
struct Item {
    Evt type;
    uint8_t length;
    uint16_t handle;
    uint8_t addr[7];  // the identity address (6 bytes as the stack gives them) and its type
    uint8_t data[64];
};

QueueHandle_t queue = nullptr;
NimBLEServer *serverPtr = nullptr;
NimBLECharacteristic *characteristic = nullptr;
NvsStore store;
const char *kAcceptedKey = "ble_ok";  // the accepted devices, as text. Not a secret: addresses only

PeerAddr toPeer(const uint8_t *a) {
    PeerAddr p;
    memcpy(p.bytes, a, 6);
    p.type = a[6];
    return p;
}
NimBLEAddress toNim(const PeerAddr &p) {
    return NimBLEAddress(p.bytes, p.type);
}
void fill(Item &item, const NimBLEAddress &a) {
    memcpy(item.addr, a.getVal(), 6);
    item.addr[6] = a.getType();
}

void post(Evt type, uint16_t handle, const uint8_t *data = nullptr, size_t length = 0, const NimBLEAddress *address = nullptr) {
    Item item{};
    item.type = type;
    item.handle = handle;
    item.length = (uint8_t)(length > sizeof item.data ? sizeof item.data : length);  // a longer write is cut, never overrun
    if (data && item.length) {
        memcpy(item.data, data, item.length);
    }
    if (address) {
        fill(item, *address);
    }
    xQueueSend(queue, &item, 0);
}

class ServerEvents : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer *, NimBLEConnInfo &info) override {
        // the stack's idea of "bonded" proves nothing: the hub keeps its own list of accepted devices (blemidi.h)
        NimBLEAddress id = info.getIdAddress();
        post(Evt::Connect, info.getConnHandle(), nullptr, 0, &id);
        if (info.isEncrypted()) {
            post(Evt::Encrypted, info.getConnHandle(), nullptr, 0, &id);
        }
    }
    void onDisconnect(NimBLEServer *, NimBLEConnInfo &info, int) override { post(Evt::Disconnect, info.getConnHandle()); }
    void onAuthenticationComplete(NimBLEConnInfo &info) override {
        if (info.isEncrypted() && info.isBonded()) {
            NimBLEAddress id = info.getIdAddress();  // after pairing this is the identity address
            post(Evt::Encrypted, info.getConnHandle(), nullptr, 0, &id);
        }
    }
};

class CharacteristicEvents : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &info) override {
        NimBLEAttValue value = c->getValue();
        post(Evt::Data, info.getConnHandle(), value.data(), value.length());
    }
    void onSubscribe(NimBLECharacteristic *, NimBLEConnInfo &info, uint16_t subValue) override {
        post(subValue & 1 ? Evt::Subscribe : Evt::Unsubscribe, info.getConnHandle());
    }
};

class NimblePort : public BlePort {
   public:
    void startAdvertising() override { NimBLEDevice::startAdvertising(); }
    bool notify(const uint8_t *data, size_t length) override {
        return characteristic != nullptr && characteristic->notify(data, length);
    }
};

NimblePort port;
GuideSet *guideSet = nullptr;
BleMidiLink *link = nullptr;
ServerEvents serverEvents;
CharacteristicEvents characteristicEvents;

}  // namespace

void BleMidiService::begin(GuideSet &guides) {
    guideSet = &guides;
    static BleMidiLink theLink(port, guides);
    link = &theLink;
    queue = xQueueCreate(16, sizeof(Item));
    if (queue == nullptr) {
        return;
    }
    NimBLEDevice::init("MELOPHOS Hub");
    // bonding with encryption and no pass key (the hub has no screen or keys): Secure Connections, bond stored
    NimBLEDevice::setSecurityAuth(true, false, true);
    NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
    NimBLEServer *server = NimBLEDevice::createServer();
    serverPtr = server;
    server->setCallbacks(&serverEvents);
    NimBLEService *service = server->createService(kServiceUuid);
    characteristic = service->createCharacteristic(
        kCharacteristicUuid,
        NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::NOTIFY);  // reads and writes need an encrypted link
    characteristic->setCallbacks(&characteristicEvents);
    server->start();  // starts the services as well
    NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
    advertising->addServiceUUID(kServiceUuid);
    advertising->setName("MELOPHOS Hub");
    // the accepted list comes from storage. Every bond the stack holds that is not on it is deleted now
    char text[AcceptedPeers::kTextMax + 8];
    size_t length = 0;
    if (store.get(kAcceptedKey, text, sizeof text - 1, length)) {
        text[length] = '\0';
        link->accepted().fromText(text);
    }
    PeerAddr bonds[8];
    size_t nb = 0;
    for (int i = 0; i < NimBLEDevice::getNumBonds() && nb < 8; i++) {
        NimBLEAddress a = NimBLEDevice::getBondedAddress(i);
        bonds[nb].type = a.getType();
        memcpy(bonds[nb].bytes, a.getVal(), 6);
        nb++;
    }
    link->auditBonds(bonds, nb);
    link->begin();
}

void BleMidiService::poll() {
    if (queue == nullptr || link == nullptr) {
        return;
    }
    Item item;
    while (xQueueReceive(queue, &item, 0) == pdTRUE) {
        switch (item.type) {
            case Evt::Connect: {
                BleMidiLink::Peer peer = link->onPeerConnect(item.handle, toPeer(item.addr), millis());
                if (peer == BleMidiLink::Peer::Refused) {
                    if (serverPtr != nullptr) {
                        serverPtr->disconnect(item.handle);  // not on the list and pairing is closed
                    }
                } else if (peer == BleMidiLink::Peer::Waiting) {
                    Serial.printf("ble: a new device %s wants to pair. If that is you send 'ble accept' within two minutes\n",
                                  NimBLEAddress(item.addr, item.addr[6]).toString().c_str());
                }
                break;
            }
            case Evt::Encrypted:
                link->onPeerIdentity(item.handle, toPeer(item.addr));
                link->onPeerEncrypted(item.handle);
                break;
            case Evt::PairingOpen:
                link->openPairing(millis());
                break;
            case Evt::Accept:
                Serial.println(link->acceptWaiting() ? "ble: the device is accepted" : "ble: no device is waiting");
                break;
            case Evt::Disconnect:
                link->onPeerDisconnect(item.handle);
                break;
            case Evt::Subscribe:
                if (item.handle == link->trustedHandle()) {
                    link->onSubscribe(true);
                }
                break;
            case Evt::Unsubscribe:
                if (item.handle == link->trustedHandle()) {
                    link->onSubscribe(false);
                }
                break;
            case Evt::Data:
                link->onPeerReceive(item.handle, item.data, item.length, millis());
                break;
        }
    }
    uint16_t waitingBefore = link->waitingHandle();
    if (link->expireWaiting(millis())) {
        if (serverPtr != nullptr) {
            serverPtr->disconnect(waitingBefore);
        }
        Serial.println("ble: the waiting device was not accepted in time and was forgotten");
    }
    // a bond that is not on the accepted list goes at once (by identity address, whatever its type)
    PeerAddr gone;
    while (link->takeBondToDelete(gone)) {
        NimBLEDevice::deleteBond(toNim(gone));
    }
    if (link->takeAcceptedChanged()) {
        char text[AcceptedPeers::kTextMax + 8];
        link->accepted().toText(text, sizeof text);
        store.put(kAcceptedKey, text, strlen(text));
    }
    link->pump();
}

void BleMidiService::openPairing() {
    if (queue != nullptr) {
        post(Evt::PairingOpen, 0);
    }
}

void BleMidiService::acceptWaiting() {
    if (queue != nullptr) {
        post(Evt::Accept, 0);
    }
}

void BleMidiService::sendPlayed(const NoteEvent &event) {
    if (link) {
        link->queueOut(event);
    }
}

bool BleMidiService::connected() const {
    return link != nullptr && link->connected();
}

}  // namespace melophos
