import { isBlackKey, keyRange, noteName } from "./notes";

// an on-screen keyboard with the hub's light strip above it. White keys share the width evenly and
// black keys sit across the gap between two white keys, so it fits any screen without scrolling.
export class Keyboard {
  private readonly keys = new Map<number, HTMLElement>();
  private readonly leds = new Map<number, HTMLElement>();

  constructor(container: HTMLElement, lowest: number, highest: number) {
    const notes = keyRange(lowest, highest);
    const whites = notes.filter((n) => !isBlackKey(n)).length;
    container.style.setProperty("--whites", String(whites));

    const strip = document.createElement("div");
    strip.className = "led-strip";
    strip.setAttribute("aria-hidden", "true");
    const keys = document.createElement("div");
    keys.className = "keys";

    let whiteIndex = 0;
    for (const note of notes) {
      const black = isBlackKey(note);
      // a white key's centre is half a key in; a black key's is on the line after the last white key
      const centre = black ? whiteIndex : whiteIndex + 0.5;
      const key = document.createElement("div");
      key.className = black ? "key black" : "key white";
      key.dataset["note"] = String(note);
      key.setAttribute("aria-label", noteName(note));
      key.style.setProperty("--x", String(black ? whiteIndex : whiteIndex));
      const led = document.createElement("span");
      led.className = "led";
      led.style.setProperty("--x", String(centre));
      strip.append(led);
      keys.append(key);
      this.keys.set(note, key);
      this.leds.set(note, led);
      if (!black) whiteIndex += 1;
    }
    container.append(strip, keys);
  }

  setPressed(note: number, pressed: boolean, wrong = false): void {
    const key = this.keys.get(note);
    key?.classList.toggle("pressed", pressed && !wrong);
    key?.classList.toggle("wrong", pressed && wrong);
  }

  // the next note glows brightly and the ones after it dimly, as the light strip shows them
  guide(upcoming: number[]): void {
    for (const led of this.leds.values()) led.classList.remove("next", "soon");
    upcoming.forEach((note, i) => this.leds.get(note)?.classList.add(i === 0 ? "next" : "soon"));
  }
}
