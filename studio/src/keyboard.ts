import { isBlackKey, keyRange, noteName } from "./notes";

export class Keyboard {
  private readonly keys = new Map<number, HTMLElement>();

  constructor(container: HTMLElement, lowest: number, highest: number) {
    for (const note of keyRange(lowest, highest)) {
      const key = document.createElement("div");
      key.className = isBlackKey(note) ? "key black" : "key white";
      key.dataset["note"] = String(note);
      key.setAttribute("aria-label", noteName(note));
      container.append(key);
      this.keys.set(note, key);
    }
  }

  setPressed(note: number, pressed: boolean): void {
    this.keys.get(note)?.classList.toggle("pressed", pressed);
  }
}
