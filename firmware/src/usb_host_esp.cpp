#include "usb_host_esp.h"

#include <sdkconfig.h>

#include "melophos_config.h"

#if defined(CONFIG_IDF_TARGET_ESP32S3)

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <usb/usb_host.h>

#include "hal.h"
#include "midi.h"
#include "usbhost.h"

namespace melophos {

namespace {

// everything the USB tasks tell the main loop travels through this queue, so
// the state machine and the note bus each keep a single thread of control
enum class Msg : uint8_t { Attached, Detached, Enumerated, Rejected, Data };
struct Item {
    Msg type;
    uint8_t length;
    uint8_t data[64];
};

QueueHandle_t queue = nullptr;
usb_host_client_handle_t client = nullptr;
usb_device_handle_t device = nullptr;
usb_transfer_t *transfer = nullptr;
uint8_t openAddress = 0;
uint8_t inEndpoint = 0;
uint8_t claimedInterface = 0xFF;
volatile bool wantOpen = false;
volatile bool wantRelease = false;

void post(Msg type, const uint8_t *data = nullptr, size_t length = 0) {
    Item item{};
    item.type = type;
    item.length = (uint8_t)(length > sizeof item.data ? sizeof item.data : length);
    if (data && item.length) {
        memcpy(item.data, data, item.length);
    }
    xQueueSend(queue, &item, 0);  // a full queue drops the packet: the bus would have dropped it anyway
}

void onTransfer(usb_transfer_t *t) {
    if (t->status == USB_TRANSFER_STATUS_COMPLETED && t->actual_num_bytes > 0) {
        // a transfer holds whole 4 byte packets, at most 64 bytes of them
        post(Msg::Data, t->data_buffer, (size_t)t->actual_num_bytes);
    }
    if (t->status == USB_TRANSFER_STATUS_NO_DEVICE || t->status == USB_TRANSFER_STATUS_CANCELED) {
        return;  // the device is gone: do not resubmit
    }
    usb_host_transfer_submit(t);
}

void releaseDevice() {
    if (device) {
        if (inEndpoint) {
            usb_host_endpoint_halt(device, inEndpoint);
            usb_host_endpoint_flush(device, inEndpoint);
        }
        if (claimedInterface != 0xFF) {
            usb_host_interface_release(client, device, claimedInterface);
        }
        usb_host_device_close(client, device);
    }
    if (transfer) {
        usb_host_transfer_free(transfer);
        transfer = nullptr;
    }
    device = nullptr;
    inEndpoint = 0;
    claimedInterface = 0xFF;
}

// walks the configuration descriptor for a MIDI streaming interface (audio
// class 1, subclass 3) and its bulk IN endpoint
bool findMidiEndpoint(const usb_config_desc_t *config, uint8_t &interfaceNumber, uint8_t &endpoint, uint16_t &maxPacket) {
    const uint8_t *p = reinterpret_cast<const uint8_t *>(config);
    size_t total = config->wTotalLength;
    size_t at = 0;
    bool inMidi = false;
    while (at + 2 <= total) {
        uint8_t len = p[at];
        uint8_t type = p[at + 1];
        if (len < 2 || at + len > total) {
            return false;  // a malformed descriptor ends the search
        }
        if (type == USB_B_DESCRIPTOR_TYPE_INTERFACE && len >= sizeof(usb_intf_desc_t)) {
            const usb_intf_desc_t *i = reinterpret_cast<const usb_intf_desc_t *>(p + at);
            inMidi = i->bInterfaceClass == 0x01 && i->bInterfaceSubClass == 0x03 && i->bAlternateSetting == 0;
            if (inMidi) {
                interfaceNumber = i->bInterfaceNumber;
            }
        } else if (type == USB_B_DESCRIPTOR_TYPE_ENDPOINT && inMidi && len >= sizeof(usb_ep_desc_t)) {
            const usb_ep_desc_t *e = reinterpret_cast<const usb_ep_desc_t *>(p + at);
            if ((e->bEndpointAddress & 0x80) && (e->bmAttributes & 0x03) == 0x02) {
                endpoint = e->bEndpointAddress;
                maxPacket = e->wMaxPacketSize;
                return true;
            }
        }
        at += len;
    }
    return false;
}

void openMidiDevice() {
    if (usb_host_device_open(client, openAddress, &device) != ESP_OK) {
        post(Msg::Rejected);
        return;
    }
    const usb_config_desc_t *config = nullptr;
    uint8_t interfaceNumber = 0;
    uint16_t maxPacket = 0;
    if (usb_host_get_active_config_descriptor(device, &config) != ESP_OK ||
        !findMidiEndpoint(config, interfaceNumber, inEndpoint, maxPacket)) {
        releaseDevice();
        post(Msg::Rejected);  // a device without a MIDI streaming interface
        return;
    }
    if (usb_host_interface_claim(client, device, interfaceNumber, 0) != ESP_OK) {
        releaseDevice();
        post(Msg::Rejected);
        return;
    }
    claimedInterface = interfaceNumber;
    size_t size = maxPacket > 64 ? 64 : (maxPacket < 4 ? 4 : maxPacket);
    if (usb_host_transfer_alloc(size, 0, &transfer) != ESP_OK) {
        releaseDevice();
        post(Msg::Rejected);
        return;
    }
    transfer->device_handle = device;
    transfer->bEndpointAddress = inEndpoint;
    transfer->num_bytes = (int)size;
    transfer->callback = onTransfer;
    if (usb_host_transfer_submit(transfer) != ESP_OK) {
        releaseDevice();
        post(Msg::Rejected);
        return;
    }
    post(Msg::Enumerated);
}

void clientEvent(const usb_host_client_event_msg_t *msg, void *) {
    if (msg->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
        openAddress = msg->new_dev.address;
        post(Msg::Attached);
    } else if (msg->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
        wantRelease = true;
        post(Msg::Detached);
    }
}

void libraryTask(void *) {
    for (;;) {
        uint32_t flags = 0;
        usb_host_lib_handle_events(portMAX_DELAY, &flags);
    }
}

void clientTask(void *) {
    for (;;) {
        usb_host_client_handle_events(client, pdMS_TO_TICKS(20));
        if (wantRelease) {
            wantRelease = false;
            releaseDevice();
        }
        if (wantOpen) {
            wantOpen = false;
            openMidiDevice();
        }
    }
}

class EspPower : public UsbPower {
   public:
    void setVbus(bool on) override { digitalWrite(PIN_HOST_EN, on ? HIGH : LOW); }
};

class EspPort : public UsbHostPort {
   public:
    void beginEnumeration() override { wantOpen = true; }
    void release() override { wantRelease = true; }
};

class ArduinoClock : public Clock {
   public:
    uint32_t nowMs() const override { return millis(); }
};

ArduinoClock hostClock;
EspPower power;
EspPort port;
UsbHostFsm fsm(hostClock, power, port);
UsbMidiParser parser;
NoteBus *noteBus = nullptr;
bool started = false;
volatile bool wantAllowed = true;

}  // namespace

void UsbMidiHost::begin(NoteBus &bus) {
    noteBus = &bus;
    pinMode(PIN_HOST_EN, OUTPUT);
    digitalWrite(PIN_HOST_EN, LOW);
    pinMode(PIN_HOST_FAULT, INPUT);  // R16 pulls it high: low means a fault
    queue = xQueueCreate(32, sizeof(Item));
    usb_host_config_t config = {};
    config.skip_phy_setup = false;
    config.intr_flags = ESP_INTR_FLAG_LEVEL1;
    if (queue == nullptr || usb_host_install(&config) != ESP_OK) {
        return;
    }
    usb_host_client_config_t clientConfig = {};
    clientConfig.is_synchronous = false;
    clientConfig.max_num_event_msg = 8;
    clientConfig.async.client_event_callback = clientEvent;
    clientConfig.async.callback_arg = nullptr;
    if (usb_host_client_register(&clientConfig, &client) != ESP_OK) {
        return;
    }
    xTaskCreate(libraryTask, "usb-lib", 4096, nullptr, 5, nullptr);
    xTaskCreate(clientTask, "usb-client", 4096, nullptr, 5, nullptr);
    fsm.begin();
    started = true;
}

bool UsbMidiHost::available() const {
    return started && fsm.streaming();
}

void UsbMidiHost::setPowerAllowed(bool allowed) {
    wantAllowed = allowed;  // applied in poll(), on the thread that owns the state machine
}

void UsbMidiHost::poll() {
    if (!started) {
        return;
    }
    fsm.setPowerAllowed(wantAllowed);
    if (digitalRead(PIN_HOST_FAULT) == LOW) {
        fsm.onOvercurrent();
    }
    BusSink sink(*noteBus);
    Item item;
    while (xQueueReceive(queue, &item, 0) == pdTRUE) {
        switch (item.type) {
            case Msg::Attached:
                fsm.onDeviceAttached();
                break;
            case Msg::Detached:
                fsm.onDeviceDetached();
                break;
            case Msg::Enumerated:
                fsm.onEnumerated(true, true);
                break;
            case Msg::Rejected:
                fsm.onEnumerated(true, false);
                break;
            case Msg::Data:
                if (fsm.streaming()) {
                    parser.feedTransfer(item.data, item.length, millis(), sink);
                }
                break;
        }
    }
    fsm.tick();
}

}  // namespace melophos

#else

namespace melophos {

void UsbMidiHost::begin(NoteBus &) {}
void UsbMidiHost::poll() {}
bool UsbMidiHost::available() const {
    return false;
}
void UsbMidiHost::setPowerAllowed(bool) {}

}  // namespace melophos

#endif
