#include <Arduino.h>

#include "ble_midi_esp.h"
#include "audiogate.h"
#include "hub.h"
#include "inlet.h"
#include "inputs.h"
#include "keymap.h"
#include "buzzer.h"
#include "buzzer_esp.h"
#include "encoder_esp.h"
#include "leds.h"
#include "network_esp.h"
#include "ota_esp.h"
#include "melophos_config.h"
#include "outputguard.h"
#include "notebus.h"
#include "practice.h"
#include "profilecmd.h"
#include "profilestore.h"
#include "render.h"
#include "recordpair.h"
#include "storage_esp.h"

using namespace melophos;

namespace {

class ArduinoClock : public Clock {
   public:
    uint32_t nowMs() const override { return millis(); }
};

// a short piece for bring-up: C major up one octave, a beat apart. Lessons
// from the Studio arrive in a later issue
const LessonStep kBringUpScale[] = {{0, 1, {60}, 0},  {4, 1, {62}, 0},  {8, 1, {64}, 0},  {12, 1, {65}, 0},
                                    {16, 1, {67}, 0}, {20, 1, {69}, 0}, {24, 1, {71}, 0}, {28, 1, {72}, 0}};

ArduinoClock appClock;
NoteBus noteBus;
Leds leds;
OutputGuard guard(appClock, leds);  // the flash limit and the current ceiling, the last step before the strip
PracticeHub hub(appClock, guard, noteBus, MAX_KEY_LEDS);
Network network;
BuzzerPin buzzerPin;
BuzzerLock buzzerLock;
SerialisedOutput buzzerOut(buzzerPin, buzzerLock);  // the loop task and the esp_timer task both reach the pin through this
Buzzer buzzer(buzzerOut, appClock, MELOPHOS_JTAG != 0);  // silent unless the stored setting turns sound on. Nothing asks it for a sound yet
Encoder encoder;                                // events are queued and nothing reads them yet
InletSense inletSense;
InletGate inletGate;  // a flapping SENSE_VIN cannot flap the supply ceiling: absent for at least 1 s, back after 500 ms of steady reading
AudioControl audio;
OtaService ota;
bool storageOk = false;
GuideSet bleGuides;
BleMidiService ble;

// each played note feeds the session and goes back to a Bluetooth host
class NoteTap : public NoteListener {
   public:
    void onNote(const NoteEvent &event) override {
        network.onNote(event);
        ble.sendPlayed(event);
    }
};
NoteTap sessionTap;
PartitionFlash profileFlash;
PartitionFlash stateFlash;
PartitionFlash outboxFlash;
ProfileStore profileStore(profileFlash);
PracticeSettings practiceSettings;
RenderSettings renderSettings;

// the two readings, calibrated, in millivolts on the pin. SENSE_VIN is -1 where it is not fitted
uint16_t readRailPinMv() {
#if MELOPHOS_BENCH_SUPPLY
    return 2500;  // a development kit on a bench supply: no inlet to sense, the rail counts as good
#else
    return (uint16_t)analogReadMilliVolts(PIN_SENSE_5V);
#endif
}
// SENSE_VIN is a LOGIC input: it sits on the second ADC unit, which cannot be used while Wi-Fi runs
int8_t readVin() {
#if SENSE_VIN_FITTED
    return digitalRead(PIN_SENSE_VIN) == HIGH ? 1 : 0;
#else
    return -1;
#endif
}

// what follows from the inlet being present or not. Without it the strip has no supply: the +5V rail is at
// most 1.24 V from USB-C alone, so the LED ceiling is 0 and every frame is sent dark (data into an
// unpowered strip would only back-feed it). The keyboard port stays off, audio is refused, the status LED
// blinks slowly and serial says why once a minute
// the guard's supply ceiling from the inlet and the stored rating. it runs whenever either changes, so a new
// `provision supply` setting takes effect at once
void refreshSupplyCeiling(bool present) {
    guard.setSupplyCeiling(supplyCeilingFor(present, network.supplyMa()));
}

void applyInlet() {
    static bool last = true;
    static uint32_t lastSay = 0;
    bool present = inletGate.step(inletSense.present(), millis());
    if (present != last || lastSay == 0) {
        last = present;
        refreshSupplyCeiling(present);
        setHostPower(present);
        if (!present) {
            guard.setAudioActive(false);
        }
    }
    if (!present) {
        bool overVoltage = inletSense.state() == InletState::OverVoltage;
        // 1 Hz without the inlet and 2 Hz for an over-voltage lockout, both under the flash limit
        digitalWrite(PIN_STATUS_LED, (millis() / (overVoltage ? 250 : 500)) % 2 ? HIGH : LOW);
        if (lastSay == 0 || millis() - lastSay > 60000) {
            lastSay = millis() ? millis() : 1;
            Serial.println(overVoltage ? "power: over-voltage lockout: the supply voltage is too high, so the LED strip, the keyboard port and audio are off. Use the right adapter"
                                       : "power: the DC inlet is not present, so the LED strip, the keyboard port and audio are off. Plug in the DC supply");
        }
    } else {
        digitalWrite(PIN_STATUS_LED, LOW);
        lastSay = lastSay == 0 ? 1 : lastSay;
    }
}

// the status is copied into fixed arrays: the main loop writes it and the network task reads it
StatusInfo makeStatus(const char *profileId, const InputStatus &in) {
    StatusInfo s{"", "", in.usbMidi, in.bleMidi, in.midiJack, in.audio, 0};
    strncpy(s.firmware, MELOPHOS_FIRMWARE_VERSION, sizeof s.firmware - 1);
    strncpy(s.profileId, profileId, sizeof s.profileId - 1);
    return s;
}

void useActiveProfile() {
    Profile p = profileStore.activeOrDefault();
    hub.setProfile(toKeyboardProfile(p));
}

void handlePracticeCommand(const char *text) {
    char message[96] = "";
    if (!strcmp(text, "off")) {
        hub.engine().stop();
    } else if (!strcmp(text, "calm on") || !strcmp(text, "calm off")) {
        practiceSettings.reducedMotion = text[6] == 'n';
        hub.setReducedMotion(practiceSettings.reducedMotion);  // live: a session in progress changes at once
    } else {
        Mode mode = !strcmp(text, "melody") ? Mode::Melody : !strcmp(text, "rhythm") ? Mode::Rhythm
                                                          : !strcmp(text, "listen") ? Mode::Listen : Mode::Off;
        if (mode == Mode::Off ||
            !hub.engine().start(mode, Lesson{kBringUpScale, sizeof kBringUpScale / sizeof kBringUpScale[0]},
                                practiceSettings, millis(), message, sizeof message)) {
            Serial.printf("practice: %s\n", message[0] ? message : "use melody, rhythm, listen, off, calm on or calm off");
        }
    }
}

// until a transport for the Studio exists, commands also arrive as lines on
// the serial port: "profile list", "profile switch <id>", "practice melody"
char serialLine[4200];  // a base64 certificate authority is the longest line
size_t serialLength = 0;
bool serialOverflow = false;

void handleLine(char *line, size_t length) {
    line[length] = '\0';
    if (length > 8 && !memcmp(line, "profile ", 8)) {
        char reply[1200];  // eight profiles with 64 character names fit
        bool changed = false;
        handleProfileCommand(profileStore, line + 8, length - 8, reply, sizeof reply, &changed);
        Serial.println(reply);
        if (changed) {
            useActiveProfile();
        }
    } else if (length > 9 && !memcmp(line, "practice ", 9)) {
        handlePracticeCommand(line + 9);
    } else if (length > 10 && !memcmp(line, "provision ", 10)) {
        char reply[300];
        network.provision(line + 10, length - 10, reply, sizeof reply);
        Serial.println(reply);
        buzzer.setSoundOn(network.soundOn());  // a provisioning command may have cleared everything
        hub.setInsecure(network.insecure());
        refreshSupplyCeiling(inletGate.present());  // a new supply rating lowers the LED ceiling now, not at the next restart
    } else if (!strcmp(line, "factory-reset")) {
        // the owner's Wi-Fi (and the Wi-Fi driver's own copy), broker, identity and certificate authority, every
        // stored profile and the saved last session. The boot counter and the update version floor stay: they
        // must never go backwards
        buzzer.setSoundOn(false);  // off at once, before the erase that can block for seconds
        network.forgetEverything();
        bool erased = network.factoryReset(profileFlash, outboxFlash);
        Serial.println(erased ? "factory reset done: restart the hub" : "factory reset: some flash could not be erased, restart the hub and try again");
    } else if (!strcmp(line, "audio on") || !strcmp(line, "audio off")) {
        char reply[300];
        audio.request(line[7] == 'n', inletGate.present(), reply, sizeof reply);
        guard.setAudioActive(audio.on());  // a lower LED ceiling while audio runs
        Serial.println(reply);  // the same JSON the Studio will get over its transport
    } else if (!strcmp(line, "ble pair")) {
        ble.openPairing();
        Serial.println("ble: pairing is open for two minutes");
    } else if (!strcmp(line, "sound on") || !strcmp(line, "sound off")) {
        bool on = line[6] == 'o' && line[7] == 'n';
        bool stored = network.setSoundOn(on);  // the buzzer follows what was stored: a failed write leaves it off
        Serial.println(applySoundCommand(buzzer, on, stored));
    } else if (length > 11 && !memcmp(line, "aux length ", 11)) {
        // takes effect after a restart: FastLED is told the strip's length once, at start-up
        const char *why = "";
        uint32_t n = 0;
        if (!parseUnsigned(line + 11, (uint32_t)kAuxLedsMax, n)) {  // digits only, the whole argument, range checked before any cast
            Serial.println("aux: the length must be a whole number from 0 to the longest strip the hub supports, for example `aux length 60`");
        } else if (network.setAuxLength((uint16_t)n, &why)) {
            Serial.println("aux: saved. Restart the hub for the new length to be used");
        } else {
            Serial.println(why);
        }
    } else if (!strcmp(line, "ble accept")) {
        ble.acceptWaiting();
    } else if (!strcmp(line, "queue clear-stale")) {
        network.clearStale();
    } else if (!strcmp(line, "unclaim")) {
        network.unclaim();  // the answer is printed by the network task
    } else if (!strcmp(line, "update")) {
        Serial.printf("update: %s\n", ota.checkNow(MELOPHOS_VERSION_NUMBER));
    }
}

void pollSerialCommands() {
    // at most 256 bytes a pass, so a stream on the serial port cannot hold the lights up
    for (int budget = 0; budget < 256 && Serial.available() > 0; budget++) {
        int c = Serial.read();
        if (c == '\n' || c == '\r') {
            if (!serialOverflow) {
                handleLine(serialLine, serialLength);
            }
            serialLength = 0;
            serialOverflow = false;
        } else if (serialLength < sizeof serialLine - 1) {
            serialLine[serialLength++] = (char)c;
        } else {
            serialOverflow = true;  // too long: the whole line is dropped
        }
    }
}

}  // namespace

void setup() {
    // MIDI out first of all: the pin may glitch low for 60 microseconds as the module powers up, so it is
    // driven high as early as the firmware can
    pinMode(PIN_MIDI_TX, OUTPUT);
    digitalWrite(PIN_MIDI_TX, HIGH);
    // the safe states of the new outputs, before anything that can take time. The board holds them off at reset
    // with pull-downs, so this only makes the firmware agree. GPIO 39, 41 and 42 (the spare header) are left
    // untouched unless a build claims them. The buzzer's pin is never driven by a build for a board that has JTAG
    // on it (MELOPHOS_JTAG)
#if PIN_LED_AUX >= 0
    pinMode(PIN_LED_AUX, OUTPUT);
    digitalWrite(PIN_LED_AUX, LOW);
#endif
#if PIN_BUZZER >= 0 && !MELOPHOS_JTAG
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
#endif
#if PIN_ENC_A >= 0
    pinMode(PIN_ENC_A, INPUT);
    pinMode(PIN_ENC_B, INPUT);
    pinMode(PIN_ENC_SW, INPUT);
#endif
#if MELOPHOS_CLAIM_SPARE_PINS
    // a build that claims the spare header would set up GPIO 39, 41 and 42 here. None does today
#endif
    guard.setLayout(MAX_KEY_LEDS, LAYOUT_FRET_LEDS, LAYOUT_AUX_LEDS);  // one frame over every output
    // then every LED output goes dark at its maximum length, before anything else and before any storage is read
    // (a flash scan or erase can take a while)
    leds.begin();
    // only then the third output's length in use, a stored setting (default 60, never above the maximum the hub supports)
    uint16_t auxInUse = network.auxLength();
    guard.setAuxInUse(auxInUse);
    leds.setAuxInUse(auxInUse);
    // the inlet is read now, with the LEDs dark and before the first frame: a rail of 4.4 V or more latches it
#if !MELOPHOS_BENCH_SUPPLY
    pinMode(PIN_SENSE_5V, INPUT);
    analogSetPinAttenuation(PIN_SENSE_5V, ADC_11db);  // the highest range: the pin sits near 2.3 V. analogReadMilliVolts is calibrated
#endif
    delay(20);
    uint32_t railSum = 0;
    for (int i = 0; i < 8; i++) {
        railSum += readRailPinMv();
        delay(2);
    }
#if SENSE_VIN_FITTED
    pinMode(PIN_SENSE_VIN, INPUT);
#endif
    inletSense.begin((uint16_t)(railSum / 8), readVin());
    Serial.begin(115200);
    Serial.printf("MELOPHOS hub firmware %s\n", MELOPHOS_FIRMWARE_VERSION);
    if (!profileFlash.begin(0x40, "profiles") || profileStore.begin() != ProfileStore::Ok) {
        Serial.println("profiles: storage unavailable, using the built-in piano-88");
    } else {
        storageOk = true;
    }
    // the network reads and raises the boot counter itself, so a lost one can stop publishing
    stateFlash.begin(0x41, "state");
    ota.begin(stateFlash);  // does nothing unless the build enables updates
    pinMode(PIN_STATUS_LED, OUTPUT);
#if PIN_HOST_FAULT >= 0
    pinMode(PIN_HOST_FAULT, INPUT);
#endif
    outboxFlash.begin(0x42, "outbox");
    renderSettings.master = LED_MASTER_BRIGHTNESS;
    applyInlet();  // the supply ceiling (the adapter's rating, 5 A unless the owner said) or 0 without the inlet
    hub.setRender(renderSettings);
    hub.setListener(&sessionTap);
    hub.engine().setExternalGuides(&bleGuides);
    ble.begin(bleGuides);
    useActiveProfile();
    beginInputs(noteBus);
    network.begin(noteBus, stateFlash, outboxFlash);
    hub.setInsecure(network.insecure());
    buzzerPin.setEndTarget(&buzzerOut);
    buzzer.begin();
    buzzer.setSoundOn(network.soundOn());
    encoder.begin();
}

void loop() {
    pollInputs();
    pollSerialCommands();
    ble.poll();
    buzzer.tick();
    hub.step();
    {
        char notice[300];
        static uint32_t lastRailMs = 0;
        static uint32_t lastInletMs = 0;
        if (millis() - lastRailMs >= 200) {  // the rail is read five times a second, not every pass
            lastRailMs = millis();
            guard.setRailPinMv(readRailPinMv());
        }
        if (millis() - lastInletMs >= 200) {
            lastInletMs = millis();
            inletSense.update(readRailPinMv(), readVin(), guard.allDark());
            applyInlet();
        }
        if (audio.poll(inletGate.present(), notice, sizeof notice)) {
            Serial.println(notice);
            guard.setAudioActive(false);
        }
    }
    InputStatus in = inputStatus();
    Mode mode = hub.engine().mode();
    char profileId[limits::kIdMax + 1] = "piano-88";
    profileStore.activeId(profileId, sizeof profileId);
    network.setContext(profileId,
                       mode == Mode::Melody ? "melody" : mode == Mode::Rhythm ? "rhythm" : mode == Mode::Listen ? "listen" : "free",
                       makeStatus(profileId, in));
    network.poll();
    // a new image is confirmed only after a minute in which storage came up and, when the network is on, the broker answered
    ota.tick(millis(), storageOk && (!network.configured() || network.everConnected()));
}
