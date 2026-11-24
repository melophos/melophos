// the player's settings. they live in this browser only. every read and write is guarded, because storage can be
// blocked, full or cleared and the app has to work the same way with none.
import { useSyncExternalStore } from "react";
import type { Accidental, Naming, OctaveConvention } from "../notes";
import type { LabelMode } from "../instrument/keyboard-view";
import { checkBase } from "./api-source";

export interface Settings {
  theme: "system" | "light" | "dark";
  contrast: "standard" | "more";
  distance: "near" | "stand" | "far";
  controls: "right" | "left";
  // "system" follows the device setting. "reduce" asks for less motion whatever the device says
  motion: "system" | "reduce";
  naming: Naming;
  octave: OctaveConvention;
  accidental: Accidental;
  labels: LabelMode;
  guidance: "auto" | "steps" | "lane";
  metronome: boolean;
  wrongSound: boolean;
  keySound: boolean;
  spoken: boolean;
  // allow a speech voice that sends the words to the browser's speech service. off until the player says so
  onlineVoice: boolean;
  // sound in the rhythm game: the tone for keys pressed on screen, the count-in click and the metronome. off until the player turns it on
  gameSound: boolean;
  // the offer of spoken note names has been shown
  speechOffered: boolean;
  volume: number;
  // the delay measured by tapping along with a click, in milliseconds, kept for the one input
  calibrationMs: number | null;
  pedal: "repeat" | "next";
  // wrong notes stay steady and the end of piece run is off
  lightSensitivity: boolean;
  // the four boxes that show the beat. they can be switched off
  beatIndicator: boolean;
  // the address of the player's own server or empty. nothing server related shows while it is empty
  serverUrl: string;
  // the one MIDI input to listen to or empty for all of them
  midiInput: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  contrast: "standard",
  distance: "near",
  controls: "right",
  motion: "system",
  naming: "english",
  octave: "c4",
  accidental: "sharp",
  labels: "c",
  guidance: "auto",
  metronome: false,
  wrongSound: false,
  keySound: true,
  spoken: false,
  onlineVoice: false,
  speechOffered: false,
  gameSound: false,
  volume: 0.6,
  calibrationMs: null,
  pedal: "repeat",
  lightSensitivity: false,
  beatIndicator: true,
  serverUrl: "",
  midiInput: "",
};

const KEY = "melophos.settings";

// each value is checked against what it may be, so a hand edited or old record cannot break the app
const CHOICES: { [K in keyof Settings]?: readonly Settings[K][] } = {
  theme: ["system", "light", "dark"],
  contrast: ["standard", "more"],
  distance: ["near", "stand", "far"],
  controls: ["right", "left"],
  motion: ["system", "reduce"],
  naming: ["english", "german", "solfege"],
  octave: ["c4", "c3"],
  accidental: ["sharp", "flat"],
  labels: ["c", "white", "none"],
  guidance: ["auto", "steps", "lane"],
  pedal: ["repeat", "next"],
};

export function sanitise(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = record[key];
    const fallback = DEFAULT_SETTINGS[key];
    const choices = CHOICES[key] as readonly unknown[] | undefined;
    if (choices) {
      if (choices.includes(value)) target[key] = value;
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") target[key] = value;
    } else if (key === "volume") {
      if (typeof value === "number" && value >= 0 && value <= 1) out.volume = value;
    } else if (key === "midiInput") {
      if (typeof value === "string" && value.length <= 120) out.midiInput = value;
    } else if (key === "serverUrl") {
      if (typeof value === "string") {
        const ok = value === "" ? null : checkBase(value);
        out.serverUrl = ok && ok.ok ? ok.base : "";
      }
    } else if (key === "calibrationMs") {
      if (value === null || (typeof value === "number" && value >= -500 && value <= 500)) out.calibrationMs = value;
    }
  }
  return out;
}

function load(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return sanitise(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = (): Settings => current;

export const SERVER_CHANGED = "melophos-server-changed";

export function updateSettings(change: Partial<Settings>): void {
  const before = current.serverUrl;
  current = sanitise({ ...current, ...change });
  // whatever changes the server address, the old server's token and data are dropped
  if (before !== current.serverUrl && typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_CHANGED));
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage is blocked or full: the setting still holds for this visit
  }
  applySettings(current);
  for (const l of listeners) l();
}

// after everything is deleted the defaults are used for this visit and nothing is written back
export function forgetSettings(): void {
  current = { ...DEFAULT_SETTINGS };
  applySettings(current);
  for (const l of listeners) l();
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULT_SETTINGS });
}

// the root attributes that tokens.css reads
export function applySettings(s: Settings, root: HTMLElement = document.documentElement): void {
  if (s.theme === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = s.theme;
  if (s.contrast === "more") root.dataset["contrast"] = "more";
  else delete root.dataset["contrast"];
  root.dataset["distance"] = s.distance;
  root.dataset["controls"] = s.controls;
  if (s.motion === "reduce") root.dataset["motion"] = "reduce";
  else delete root.dataset["motion"];
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSettings,
    getSettings,
  );
}

// true when the device asks for less motion or the player does
export function reducedMotion(s: Settings = current): boolean {
  return s.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
