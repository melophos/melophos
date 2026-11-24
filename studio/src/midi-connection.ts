// the Web MIDI connection as a small state machine, so every state the player can be in is one the interface can name:
// not supported here, needs a secure address, not asked yet, asking, allowed with no device, connected, refused and
// lost. the browser's permission prompt is only ever raised by connect(), which the interface calls from a button.
// events carry the browser's own timestamp, which is the moment the message arrived, not the moment this code ran.
import { SUSTAIN_CONTROLLER, parseControlMessage, parseNoteMessage } from "./midi";

export type MidiState =
  | { kind: "unsupported" }
  | { kind: "insecure" }
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "no-devices" }
  | { kind: "connected"; names: string[] }
  | { kind: "refused" }
  | { kind: "lost"; names: string[] }
  | { kind: "failed"; message: string };

export interface NoteInput {
  note: number;
  on: boolean;
  velocity: number;
  channel: number;
  // the event's own time, on the performance clock
  atMs: number;
}

export interface PedalInput {
  down: boolean;
  atMs: number;
}

// the parts of the browser this needs, so a test can give it a fake
export interface MidiHost {
  requestMIDIAccess?: (() => Promise<MIDIAccess>) | undefined;
  secure: boolean;
  firefox: boolean;
}

export function browserHost(): MidiHost {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  return {
    requestMIDIAccess: nav.requestMIDIAccess?.bind(nav),
    secure: window.isSecureContext,
    firefox: /firefox/i.test(navigator.userAgent),
  };
}

export function initialState(host: MidiHost): MidiState {
  if (!host.secure) return { kind: "insecure" };
  if (!host.requestMIDIAccess) return { kind: "unsupported" };
  return { kind: "idle" };
}

export interface Explanation {
  // one plain sentence that says what is true now
  headline: string;
  // what to do or what will be asked and why
  detail: string;
  // the label of the one button that moves on or null when there is nothing to press
  action: string | null;
  // true when the state is a problem and should stay until dismissed
  problem: boolean;
}

// the words for each state. the sentence before the prompt says what will be asked and why
export function explain(state: MidiState, host: Pick<MidiHost, "firefox">): Explanation {
  switch (state.kind) {
    case "unsupported":
      return {
        headline: "This browser cannot reach a MIDI keyboard.",
        detail: "Chrome, Edge and desktop Firefox can. Safari and every browser on an iPhone or iPad cannot. You can still practise with the on-screen keys or your computer keyboard.",
        action: null,
        problem: false,
      };
    case "insecure":
      return {
        headline: "MIDI needs a secure address.",
        detail: "Open the Studio from an address that starts with https or from localhost. Browsers only allow MIDI on those. You can still practise with the on-screen keys.",
        action: null,
        problem: true,
      };
    case "idle":
      return {
        headline: "No keyboard is connected yet.",
        detail: host.firefox
          ? "Pressing the button asks Firefox to install a small permission add-on, then asks whether this page may use your MIDI devices. The Studio only reads which keys you press."
          : "Pressing the button makes your browser ask whether this page may use your MIDI devices. The Studio only reads which keys you press. Nothing leaves your device.",
        action: "Connect a keyboard",
        problem: false,
      };
    case "asking":
      return { headline: "Waiting for your answer.", detail: "Your browser is asking whether this page may use your MIDI devices. Choose Allow to continue.", action: null, problem: false };
    case "no-devices":
      return { headline: "Allowed, but no keyboard was found.", detail: "Plug in or switch on your keyboard. The Studio will pick it up as soon as it appears.", action: "Look again", problem: false };
    case "connected":
      return { headline: `Connected: ${state.names.join(", ")}.`, detail: "Press any key to check it. The light on this page shows each note you play.", action: null, problem: false };
    case "refused":
      return {
        headline: "MIDI access was refused.",
        detail: "To change it, open your browser's site settings for this page, set MIDI devices to Allow and then press the button again. You can still practise with the on-screen keys.",
        action: "Try again",
        problem: true,
      };
    case "lost":
      return {
        headline: `${state.names.length === 1 ? "The keyboard" : "Your keyboards"} stopped responding.`,
        detail: "Check the cable or Bluetooth connection. The Studio carries on as soon as the keyboard comes back.",
        action: "Look again",
        problem: true,
      };
    case "failed":
      return { headline: "MIDI could not start.", detail: `The browser said: ${state.message} You can try again or use the on-screen keys.`, action: "Try again", problem: true };
  }
}

export class MidiConnection {
  private current: MidiState;
  private access: MIDIAccess | null = null;
  private lastNames: string[] = [];
  private readonly listeners = new Set<(state: MidiState) => void>();
  onNote: ((input: NoteInput) => void) | null = null;
  onPedal: ((input: PedalInput) => void) | null = null;
  // lit for as long as a note is held, so the player can see the keyboard is talking
  onActivity: ((active: boolean) => void) | null = null;
  private held = 0;
  private pedalDown = false;
  // when set, only this input is listened to. null listens to every input
  only: string | null = null;

  constructor(private readonly host: MidiHost = browserHost()) {
    this.current = initialState(host);
  }

  get state(): MidiState {
    return this.current;
  }

  subscribe(listener: (state: MidiState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: MidiState): void {
    this.current = state;
    for (const l of this.listeners) l(state);
  }

  // asks for access. only call this from a deliberate action such as a button press
  async connect(): Promise<void> {
    const request = this.host.requestMIDIAccess;
    if (!this.host.secure || !request) {
      this.set(initialState(this.host));
      return;
    }
    this.set({ kind: "asking" });
    try {
      this.access = await request();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "SecurityError" || name === "NotAllowedError") this.set({ kind: "refused" });
      else this.set({ kind: "failed", message: error instanceof Error ? error.message : "The browser gave no reason." });
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  // reads the inputs again. called on every state change so a keyboard plugged in later is found and an unplugged one is noticed
  refresh(): void {
    if (!this.access) return;
    const names: string[] = [];
    for (const input of this.access.inputs.values()) {
      if (input.state === "disconnected") continue;
      names.push(input.name ?? "MIDI input");
      const label = input.name ?? "MIDI input";
      input.onmidimessage = (event) => this.message(event, label);
    }
    if (names.length > 0) {
      this.lastNames = names;
      this.set({ kind: "connected", names });
    } else if (this.lastNames.length > 0) {
      this.releaseAll();
      this.set({ kind: "lost", names: this.lastNames });
    } else {
      this.set({ kind: "no-devices" });
    }
  }

  private releaseAll(): void {
    this.held = 0;
    this.pedalDown = false;
    this.onActivity?.(false);
  }

  private message(event: MIDIMessageEvent, from: string): void {
    if (!event.data) return;
    if (this.only !== null && this.only !== from) return;
    const note = parseNoteMessage(event.data);
    if (note) {
      const on = note.velocity > 0;
      this.held = Math.max(0, this.held + (on ? 1 : -1));
      this.onActivity?.(this.held > 0);
      this.onNote?.({ ...note, on, atMs: event.timeStamp });
      return;
    }
    const control = parseControlMessage(event.data);
    if (control && control.controller === SUSTAIN_CONTROLLER) {
      // a pedal sends a stream of values as it moves, so only the moment it crosses from up to down or back is passed on
      const down = control.value >= 64;
      if (down !== this.pedalDown) {
        this.pedalDown = down;
        this.onPedal?.({ down, atMs: event.timeStamp });
      }
    }
  }
}
