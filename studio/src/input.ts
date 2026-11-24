// the computer keyboard as a piano. one octave and a little more on the home rows, laid out by position so it works on
// any keyboard layout: the row of letters is the white keys and the row above is the black keys.
const OFFSETS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

// the bottom row moves the octave: Z down and X up
export const OCTAVE_KEYS = { down: "KeyZ", up: "KeyX" } as const;

export function computerNote(code: string, octaveShift: number, base = 60): number | null {
  const offset = OFFSETS[code];
  if (offset === undefined) return null;
  const note = base + offset + octaveShift * 12;
  return note >= 0 && note <= 127 ? note : null;
}

export const COMPUTER_KEYS = Object.keys(OFFSETS);

// a key press that should not play a note: a modifier is held or a text field has focus
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
