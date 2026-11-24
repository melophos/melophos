// the on-screen keyboard and the light rail above it, drawn as SVG and changed by setting attributes. nothing here
// fades: a key or a light changes in the same frame as the call. every state has a shape as well as a colour:
//   next, right hand   large disc          next, left hand    large square
//   coming up, right   small ring          coming up, left    small hollow square
//   wrong              a cross and the words "wrong note" in the key's name
// the shapes are drawn on the rail and again on the key, so a player who looks at either sees the same thing.
import { BLACK_WIDTH, keyBox, rangeWidth } from "../geometry";
import { isBlackKey, isMiddleC, keyRange, noteLabel, spokenName, type NameOptions } from "../notes";
import type { Hand } from "../songs";

const SVG = "http://www.w3.org/2000/svg";
// one white key is 40 units wide, which is 2.5rem at the default size. the figure scales with the player's text size
export const KEY_UNITS = 40;
// the hit area of a black key in white key widths. the drawn key is 0.6 wide
export const BLACK_HIT_WIDTH = 0.72;
const RAIL_HEIGHT = 36;
const KEYS_TOP = 40;
const WHITE_HEIGHT = 150;
const BLACK_HEIGHT = 94;
const TOTAL_HEIGHT = KEYS_TOP + WHITE_HEIGHT + 10;

export type Cue = { note: number; hand: Hand; role: "next" | "soon" };
export type LabelMode = "c" | "white" | "none";

export interface KeyboardOptions {
  lowest: number;
  highest: number;
  names: NameOptions;
  labels: LabelMode;
  // called on a press or a release. the time is the event's own timestamp
  onKey?: ((note: number, on: boolean, timeStamp: number) => void) | undefined;
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

interface KeyNodes {
  group: SVGGElement;
  light: SVGGElement;
  label: SVGTextElement | null;
}

// the five shapes, each hidden until the key's state names it
function addShapes(host: SVGGElement, cx: number, cy: number, scale: number): void {
  const r = 10 * scale;
  host.append(
    svg("circle", { class: "shape disc", cx, cy, r }),
    svg("rect", { class: "shape square", x: cx - r, y: cy - r, width: r * 2, height: r * 2 }),
    svg("circle", { class: "shape ring", cx, cy, r: r * 0.6 }),
    svg("rect", { class: "shape hollow", x: cx - r * 0.6, y: cy - r * 0.6, width: r * 1.2, height: r * 1.2 }),
    svg("path", { class: "shape diamond", d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z` }),
    svg("path", { class: "shape cross", d: `M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}` }),
  );
}

export class KeyboardView {
  readonly element: HTMLElement;
  readonly frame: HTMLElement;
  // where the lane goes: above the keys, inside the same scrolling frame, so both share one x scale
  readonly slot: HTMLElement;
  private readonly svgRoot: SVGSVGElement;
  private readonly nodes = new Map<number, KeyNodes>();
  private readonly held = new Set<number>();
  private readonly wrong = new Set<number>();
  // the key of a press the engine was not sure about: shown with a diamond and a dashed outline, counted neither way
  private readonly unsure = new Set<number>();
  private cues = new Map<number, Cue>();
  private names: NameOptions;
  private labels: LabelMode;
  private readonly lowest: number;
  private readonly highest: number;
  private readonly onKey: KeyboardOptions["onKey"];
  private readonly pointers = new Map<number, number>();
  private focused: number;
  private mapWindow: SVGRectElement | null = null;
  private readonly caption: HTMLElement;

  constructor(host: HTMLElement, options: KeyboardOptions) {
    this.lowest = options.lowest;
    this.highest = options.highest;
    this.names = options.names;
    this.labels = options.labels;
    this.onKey = options.onKey;
    this.focused = Math.min(options.highest, Math.max(options.lowest, 60));
    const width = rangeWidth(this.lowest, this.highest);

    this.element = document.createElement("div");
    this.element.className = "kb";
    this.frame = document.createElement("div");
    this.frame.className = "kb-frame";
    // the frame scrolls on its own when the keyboard is wider than the screen. it can be reached by keyboard
    this.frame.tabIndex = -1;

    this.svgRoot = svg("svg", { class: "kb-svg", viewBox: `0 0 ${width * KEY_UNITS} ${TOTAL_HEIGHT}`, role: "group", "aria-label": "Piano keys" });
    this.svgRoot.style.setProperty("--whites", String(width));
    this.svgRoot.append(svg("rect", { class: "rail", x: 0, y: 0, width: width * KEY_UNITS, height: RAIL_HEIGHT }));

    const whites = svg("g", { class: "whites" });
    const blacks = svg("g", { class: "blacks" });
    const rail = svg("g", { class: "lights" });
    const labels = svg("g", { class: "labels", "aria-hidden": "true" });
    for (const note of keyRange(this.lowest, this.highest)) {
      const box = keyBox(note, this.lowest);
      const black = box.black;
      const group = svg("g", { class: `key ${black ? "key-black" : "key-white"}`, "data-note": note, "data-cue": "none", "data-hand": "right", role: "button", tabindex: -1 });
      const x = box.x * KEY_UNITS;
      const w = box.width * KEY_UNITS;
      group.append(svg("rect", { class: "body", x, y: KEYS_TOP, width: w, height: black ? BLACK_HEIGHT : WHITE_HEIGHT, rx: 3 }));
      // a black key is narrow, so its hit area is wider than what is drawn: as wide as the neighbouring white keys allow
      if (black) {
        const hitW = KEY_UNITS * BLACK_HIT_WIDTH;
        group.append(svg("rect", { class: "hit", x: x + w / 2 - hitW / 2, y: KEYS_TOP, width: hitW, height: BLACK_HEIGHT }));
      }
      // the printed name sits outside the key's group, so the key's accessible name is the spoken one alone
      let label: SVGTextElement | null = null;
      if (!black) {
        label = svg("text", { class: "label", x: x + w / 2, y: KEYS_TOP + WHITE_HEIGHT - 40, "text-anchor": "middle", "font-size": 16, "aria-hidden": "true" });
        labels.append(label);
      }
      const mark = svg("g", { class: "mark" });
      addShapes(mark, x + w / 2, KEYS_TOP + (black ? BLACK_HEIGHT : WHITE_HEIGHT) - 18, black ? 0.8 : 1);
      group.append(mark);
      const light = svg("g", { class: "light", "data-note": note, "data-cue": "none", "data-hand": "right" });
      addShapes(light, box.centre * KEY_UNITS, RAIL_HEIGHT / 2, 1);
      (black ? blacks : whites).append(group);
      rail.append(light);
      this.nodes.set(note, { group, light, label });
    }
    this.svgRoot.append(whites, blacks, labels, rail);
    const stage = document.createElement("div");
    stage.className = "kb-stage";
    stage.style.setProperty("--whites", String(width));
    this.slot = document.createElement("div");
    this.slot.className = "kb-slot";
    stage.append(this.slot, this.svgRoot);
    this.frame.append(stage);

    this.caption = document.createElement("p");
    this.caption.className = "kb-caption";
    const map = svg("svg", { class: "kb-map", viewBox: `0 0 ${width * KEY_UNITS} 24`, preserveAspectRatio: "none", "aria-hidden": "true" });
    map.append(svg("rect", { class: "map-bed", x: 0, y: 0, width: width * KEY_UNITS, height: 24 }));
    for (const note of keyRange(this.lowest, this.highest)) {
      if (isBlackKey(note)) continue;
      const box = keyBox(note, this.lowest);
      map.append(svg("rect", { class: "map-key", x: box.x * KEY_UNITS + 1, y: 2, width: KEY_UNITS - 2, height: 20 }));
    }
    this.mapWindow = svg("rect", { class: "map-window", x: 0, y: 0, width: 10, height: 24 });
    map.append(this.mapWindow);
    this.element.append(this.frame, map, this.caption);
    host.replaceChildren(this.element);

    this.frame.addEventListener("scroll", () => this.updateMap(), { passive: true });
    this.svgRoot.addEventListener("pointerdown", (e) => this.pointerDown(e));
    this.svgRoot.addEventListener("pointerup", (e) => this.pointerUp(e));
    this.svgRoot.addEventListener("pointercancel", (e) => this.pointerUp(e));
    this.svgRoot.addEventListener("keydown", (e) => this.keyDown(e));
    this.svgRoot.addEventListener("keyup", (e) => this.keyUp(e));
    this.svgRoot.addEventListener("contextmenu", (e) => e.preventDefault());
    this.paintNames();
    this.setFocusable(this.focused);
    this.updateMap();
  }

  destroy(): void {
    this.element.remove();
  }

  setNames(names: NameOptions, labels: LabelMode): void {
    this.names = names;
    this.labels = labels;
    this.paintNames();
  }

  // the lights for the next notes and the ones coming up
  setCues(cues: readonly Cue[]): void {
    const next = new Map<number, Cue>();
    for (const cue of cues) {
      const have = next.get(cue.note);
      // a note that is next in one place and coming up in another is shown as next
      if (!have || (have.role === "soon" && cue.role === "next")) next.set(cue.note, cue);
    }
    const touched = new Set([...this.cues.keys(), ...next.keys()]);
    this.cues = next;
    for (const note of touched) this.paint(note);
  }

  setHeld(note: number, on: boolean): void {
    if (on) this.held.add(note);
    else this.held.delete(note);
    this.paint(note);
  }

  // a wrong note stays marked until the next press so the player can see which key it was
  setWrong(note: number | null): void {
    const before = [...this.wrong];
    this.wrong.clear();
    if (note !== null) this.wrong.add(note);
    for (const n of before) this.paint(n);
    if (note !== null) this.paint(note);
  }

  // a press the engine was not sure about stays marked until the next press, apart from a wrong one
  setUnsure(note: number | null): void {
    const before = [...this.unsure];
    this.unsure.clear();
    if (note !== null) this.unsure.add(note);
    for (const n of before) this.paint(n);
    if (note !== null) this.paint(note);
  }

  // scrolls the frame so a key is in view and roughly central. it never animates
  follow(note: number): void {
    const box = keyBox(note, this.lowest);
    const unitPx = this.svgRoot.getBoundingClientRect().width / (rangeWidth(this.lowest, this.highest) * KEY_UNITS);
    const centrePx = box.centre * KEY_UNITS * unitPx;
    const view = this.frame.clientWidth;
    if (centrePx < this.frame.scrollLeft + view * 0.2 || centrePx > this.frame.scrollLeft + view * 0.8) {
      this.frame.scrollLeft = Math.max(0, centrePx - view / 2);
    }
  }

  // the range of keys on screen now, for the caption and the map
  visibleRange(): { low: number; high: number } {
    const total = rangeWidth(this.lowest, this.highest);
    const px = this.svgRoot.getBoundingClientRect().width || 1;
    const left = (this.frame.scrollLeft / px) * total;
    const right = ((this.frame.scrollLeft + this.frame.clientWidth) / px) * total;
    let low = this.lowest;
    let high = this.highest;
    for (let n = this.lowest; n <= this.highest; n++) {
      const c = keyBox(n, this.lowest).centre;
      if (c >= left) {
        low = n;
        break;
      }
    }
    for (let n = this.highest; n >= this.lowest; n--) {
      const c = keyBox(n, this.lowest).centre;
      if (c <= right) {
        high = n;
        break;
      }
    }
    return { low, high };
  }

  private updateMap(): void {
    if (!this.mapWindow) return;
    const total = rangeWidth(this.lowest, this.highest) * KEY_UNITS;
    const px = this.svgRoot.getBoundingClientRect().width || 1;
    const x = (this.frame.scrollLeft / px) * total;
    const w = Math.min(total, (this.frame.clientWidth / px) * total);
    this.mapWindow.setAttribute("x", String(x));
    this.mapWindow.setAttribute("width", String(w));
    const { low, high } = this.visibleRange();
    this.caption.textContent = `Showing ${noteLabel(low, this.names)} to ${noteLabel(high, this.names)}`;
  }

  private paintNames(): void {
    for (const [note, nodes] of this.nodes) {
      if (nodes.label) {
        const show = this.labels === "white" || (this.labels === "c" && note % 12 === 0);
        nodes.label.textContent = show ? noteLabel(note, this.names) : "";
        // middle C is marked on its own, as every keyboard teacher does
        nodes.label.dataset["middle"] = isMiddleC(note) ? "true" : "false";
      }
      this.paint(note);
    }
  }

  private paint(note: number): void {
    const nodes = this.nodes.get(note);
    if (!nodes) return;
    const cue = this.cues.get(note);
    const wrong = this.wrong.has(note);
    const held = this.held.has(note);
    const state = wrong ? "wrong" : this.unsure.has(note) ? "unsure" : cue ? cue.role : "none";
    const hand = cue?.hand ?? "right";
    // an attribute is only written when its value changes, so nothing on the page is touched without a change to show
    const put = (el: Element, name: string, value: string): void => {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    };
    for (const node of [nodes.group, nodes.light]) {
      put(node, "data-cue", state);
      put(node, "data-hand", hand);
    }
    put(nodes.group, "data-held", held && !wrong ? "true" : "false");
    // a name printed on a dark fill is drawn in white
    if (nodes.label) put(nodes.label, "data-tone", wrong || (cue?.role === "next" && hand === "left") ? "light" : "dark");
    put(nodes.group, "aria-pressed", String(held));
    let name = spokenName(note, this.names);
    if (wrong) name += ", wrong note";
    else if (this.unsure.has(note)) name += ", not judged";
    else if (cue) name += cue.role === "next" ? `, next note, ${cue.hand} hand` : `, coming up, ${cue.hand} hand`;
    put(nodes.group, "aria-label", name);
  }

  private pointerDown(e: PointerEvent): void {
    const key = (e.target as Element).closest<SVGGElement>(".key");
    if (!key || e.button > 0) return;
    const note = Number(key.dataset["note"]);
    this.pointers.set(e.pointerId, note);
    this.svgRoot.setPointerCapture(e.pointerId);
    this.setFocusable(note);
    this.onKey?.(note, true, e.timeStamp);
  }

  private pointerUp(e: PointerEvent): void {
    const note = this.pointers.get(e.pointerId);
    if (note === undefined) return;
    this.pointers.delete(e.pointerId);
    this.onKey?.(note, false, e.timeStamp);
  }

  private setFocusable(note: number): void {
    this.nodes.get(this.focused)?.group.setAttribute("tabindex", "-1");
    this.focused = note;
    this.nodes.get(note)?.group.setAttribute("tabindex", "0");
  }

  // arrows move between keys, Space and Enter play the key under focus
  private keyDown(e: KeyboardEvent): void {
    const key = (e.target as Element).closest<SVGGElement>(".key");
    if (!key) return;
    const note = Number(key.dataset["note"]);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.onKey?.(note, true, e.timeStamp);
      return;
    }
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "PageUp" ? 12 : e.key === "PageDown" ? -12 : 0;
    if (step === 0) return;
    e.preventDefault();
    const target = Math.min(this.highest, Math.max(this.lowest, note + step));
    this.setFocusable(target);
    this.nodes.get(target)?.group.focus();
    this.follow(target);
  }

  private keyUp(e: KeyboardEvent): void {
    const key = (e.target as Element).closest<SVGGElement>(".key");
    if (key && (e.key === "Enter" || e.key === " ")) this.onKey?.(Number(key.dataset["note"]), false, e.timeStamp);
  }
}

export const BLACK_KEY_WIDTH_UNITS = BLACK_WIDTH * KEY_UNITS;
