// what is true of the hub firmware, as the how it works and accessibility pages state it. each statement carries checks
// that read the firmware's own files and tests/claims.test.ts runs them. the figures in the text are read from the
// source by src/lib/facts.ts, so a figure cannot be changed in the firmware without the page changing with it.
// everything here is firmware tested on a computer. nothing has run on a board.

import type { Check } from "../lib/checks.ts";
import { fact, figure } from "../lib/facts.ts";
import type { Status } from "./status.ts";

export interface HubClaim {
  id: string;
  status: Extract<Status, "host" | "planned" | "built">;
  text: string;
  checks: Check[];
}

const t = (file: string, title: string): Check => ({ test: { file, title } });

const flashesPerSecond = 1000 / fact("wrongBlinkPeriodMs");
// the page says the blink is under the limit of three a second. if the firmware ever flashes faster the build stops here
if (flashesPerSecond > 3) throw new Error(`the wrong-note blink is ${flashesPerSecond} a second and the limit is 3: the page must not call it low`);

export const HUB_CLAIMS: Record<string, HubClaim> = {
  jack: {
    id: "jack",
    status: "host",
    text: "The firmware reads a keyboard on a 3.5 mm MIDI jack and the code is tested on a computer. It has never run on a board.",
    checks: [{ exists: "firmware/lib/midi/midi.cpp" }, t("firmware/test/test_midi/test_main.cpp", "test_note_on_and_off")],
  },
  usb: {
    id: "usb",
    status: "host",
    text: "The firmware has a USB host that reads a keyboard and powers it. It is tested on a computer and has never run on a board.",
    checks: [{ exists: "firmware/lib/usbhost/usbhost.cpp" }, t("firmware/test/test_usbhost/test_main.cpp", "test_power_on_then_a_keyboard_enumerates")],
  },
  ble: {
    id: "ble",
    status: "host",
    text: "The firmware is written to appear as a Bluetooth MIDI device. It is tested on a computer and has never run on a board.",
    checks: [{ exists: "firmware/lib/blemidi/blemidi.cpp" }, t("firmware/test/test_blemidi/test_main.cpp", "test_synthesia_notes_light_and_clear_the_guides")],
  },
  audio: {
    id: "audio",
    status: "planned",
    text: "For instruments with no MIDI at all. The pins for the converter are reserved and no firmware reads it yet.",
    checks: [{ under: "firmware/src", absent: "i2s_channel_read|i2s_read\\(|I2S\\.read" }, { under: "firmware/lib", absent: "i2s_channel_read|i2s_read\\(|I2S\\.read" }],
  },
  modes: {
    id: "modes",
    status: "host",
    text: `Three modes. Melody lights the next note and waits for it for as long as it takes. Rhythm holds a tempo from ${fact("bpmMin")} to ${figure("bpmMax")} after a count-in and scores hits, early, late, missed and wrong notes. Listen plays the guide by itself.`,
    checks: [t("firmware/test/test_practice/test_main.cpp", "test_melody_waits_for_the_right_note_for_as_long_as_it_takes"), t("firmware/test/test_practice/test_main.cpp", "test_rhythm_scores_hits_early_late_missed_and_wrong"), t("firmware/test/test_practice/test_main.cpp", "test_listen_lights_each_step_in_time_and_finishes")],
  },
  calm: {
    id: "calm",
    status: "host",
    text: "The firmware has a calm setting where nothing pulses or hops and the wrong-note light is steady.",
    checks: [t("firmware/test/test_practice/test_main.cpp", "test_reduced_motion_removes_all_animation")],
  },
  secondSignal: {
    id: "secondSignal",
    status: "host",
    text: "In the firmware every light meaning has a colour and at least one other signal: brightness or a pattern. A monochrome setting turns every role white and a test checks that no two meanings then look the same.",
    checks: [t("firmware/test/test_practice/test_main.cpp", "test_every_role_differs_without_colour_in_both_motion_settings")],
  },
  flashing: {
    id: "flashing",
    status: "host",
    text: `In the firmware the only flashing light is the wrong-note blink at ${flashesPerSecond} flashes a second, under the limit of 3. A test presses wrong keys at eight different rates and checks that no second holds more than ${flashesPerSecond} flashes.`,
    checks: [
      { file: "firmware/lib/practice/practice.h", matches: "kWrongBlinkPeriodMs = \\d+;" },
      t("firmware/test/test_practice/test_main.cpp", "test_mashing_wrong_keys_never_flashes_faster_than_two_a_second"),
      t("firmware/test/test_practice/test_main.cpp", "test_wrong_blink_is_two_flashes_at_two_hertz"),
    ],
  },
  ledCap: {
    id: "ledCap",
    status: "host",
    text: `The firmware caps the total current drawn by the lights at ${figure("ledCeilingMa")}. This is a safety limit and it is one constant. It is not yet a setting a player can choose for comfort.`,
    checks: [
      { file: "firmware/lib/practice/render.h", matches: "kLedCurrentCeilingMa = \\d+;" },
      // the guard in render.h is the cap. leds.cpp sets the library's own limit just above it as a last resort, from the same constant
      { file: "firmware/src/leds.cpp", contains: "FastLED.setMaxPowerInMilliWatts(5u * (kLedCurrentCeilingMa + 100u) + 250u)" },
      t("firmware/test/test_practice/test_main.cpp", "test_the_ceiling_is_the_boards_figure_and_the_last_step_before_the_strip"),
      t("firmware/test/test_practice/test_main.cpp", "test_ceiling_holds_for_the_worst_frame"),
    ],
  },
  colours: {
    id: "colours",
    status: "host",
    text: "The firmware uses the adopted colour table: amber for the next note and the right hand, blue for the left hand and rose-magenta for a wrong note. The same table is in the Studio, so the screen and the lights tell the same colour story.",
    checks: [
      t("firmware/test/test_practice/test_main.cpp", "test_final_light_colours_and_currents"),
      { file: "firmware/lib/practice/render.cpp", contains: "kAmber[3] = {255, 150, 0}" },
      { file: "firmware/lib/practice/render.cpp", contains: "kBlue[3] = {0, 110, 255}" },
      { file: "firmware/lib/practice/render.cpp", contains: "kRed[3] = {255, 0, 160}" },
    ],
  },
  studioControl: {
    id: "studioControl",
    status: "planned",
    text: "The plan is that a fitted hub decides the light and the Studio becomes its remote control. The firmware can take profile commands from the Studio. The Studio has no screen that sends them yet.",
    checks: [{ exists: "firmware/lib/profilecmd" }, { file: "studio/README.md", contains: "Hub control, the fit wizard and the firmware installer" }],
  },
};
