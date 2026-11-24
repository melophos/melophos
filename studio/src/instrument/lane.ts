// the lane: notes fall towards the keys they name. one canvas above the keyboard, sharing the keyboard's x scale.
// position comes from the master clock and nothing else. no text is ever drawn on the canvas, because it cannot be
// zoomed, restyled or read aloud: every word lives in HTML beside it.
// the right hand is a solid bar and the left hand a hatched bar, so the hands differ by pattern as well as colour.
// under reduced motion the lane draws one phrase as a still page and the current note is marked.
import { keyBox, rangeWidth } from "../geometry";
import type { TimedNote } from "../piece";

export interface LaneColours {
  bed: string;
  right: string;
  left: string;
  ink: string;
  paper: string;
}

export type LaneMode = "scroll" | "page";

const token = (style: CSSStyleDeclaration, name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;

// the colours are read from the tokens at start and again when the theme, the contrast or forced colours change
export function readLaneColours(root: HTMLElement = document.documentElement): LaneColours {
  const style = getComputedStyle(root);
  if (window.matchMedia("(forced-colors: active)").matches) {
    // the system chooses the colours, so they are read from the system colour keywords
    const probe = document.createElement("span");
    root.append(probe);
    const read = (keyword: string): string => {
      probe.style.color = keyword;
      return getComputedStyle(probe).color;
    };
    const colours = { bed: read("Canvas"), right: read("Highlight"), left: read("LinkText"), ink: read("CanvasText"), paper: read("CanvasText") };
    probe.remove();
    return colours;
  }
  return {
    bed: token(style, "--rail", "CanvasText"),
    right: token(style, "--light-right", "CanvasText"),
    left: token(style, "--light-left", "CanvasText"),
    ink: token(style, "--rail", "CanvasText"),
    paper: token(style, "--key-white", "CanvasText"),
  };
}

export interface LaneOptions {
  lowest: number;
  highest: number;
  // beats visible above the hit line while scrolling
  lookBeats?: number;
}

export class Lane {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private notes: readonly TimedNote[] = [];
  private beatsPerBar = 4;
  private longest = 1;
  private done: ReadonlySet<number> = new Set<number>();
  private current: ReadonlySet<number> = new Set<number>();
  private colours: LaneColours;
  private hatch: CanvasPattern | null = null;
  private mode: LaneMode = "scroll";
  private page = { from: 0, to: 16 };
  private width = 1;
  private height = 1;
  private ratio = 1;
  private readonly lookBeats: number;
  private readonly observer: ResizeObserver;
  private readonly lowest: number;
  private readonly total: number;
  // the last thing drawn, so a call with nothing new is free
  private lastKey = "";
  private lastPosition = 0;

  constructor(host: HTMLElement, options: LaneOptions) {
    this.lowest = options.lowest;
    this.total = rangeWidth(options.lowest, options.highest);
    this.lookBeats = options.lookBeats ?? 6;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "lane-canvas";
    // the picture is decoration for sighted players. the same information is in the text line beside it
    this.canvas.setAttribute("aria-hidden", "true");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("The lane needs a 2D canvas");
    this.ctx = ctx;
    this.colours = readLaneColours();
    host.replaceChildren(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  destroy(): void {
    this.observer.disconnect();
    this.canvas.remove();
  }

  setNotes(notes: readonly TimedNote[], beatsPerBar: number): void {
    this.notes = notes;
    this.longest = notes.reduce((m, n) => Math.max(m, n.beats), 0);
    this.beatsPerBar = beatsPerBar;
    this.lastKey = "";
  }

  setDone(done: ReadonlySet<number>): void {
    this.done = done;
    this.lastKey = "";
  }

  setCurrent(current: ReadonlySet<number>): void {
    this.current = current;
    this.lastKey = "";
  }

  setMode(mode: LaneMode): void {
    this.mode = mode;
    this.lastKey = "";
  }

  // the phrase a still page shows, in beats
  setPage(fromBeat: number, toBeat: number): void {
    this.page = { from: fromBeat, to: Math.max(toBeat, fromBeat + 1) };
    this.lastKey = "";
  }

  // call when the theme, the contrast setting or forced colours change
  refreshColours(): void {
    this.colours = readLaneColours();
    this.hatch = null;
    this.lastKey = "";
  }

  private resize(): void {
    const box = this.canvas.parentElement?.getBoundingClientRect();
    if (!box) return;
    this.ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(box.width));
    this.height = Math.max(1, Math.round(box.height));
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.hatch = null;
    this.lastKey = "";
    // changing the size clears the canvas, so the last picture is drawn again
    this.draw(this.lastPosition);
  }

  private hatchPattern(): CanvasPattern | null {
    if (this.hatch) return this.hatch;
    const tile = document.createElement("canvas");
    tile.width = 12;
    tile.height = 12;
    const t = tile.getContext("2d");
    if (!t) return null;
    t.strokeStyle = this.colours.ink;
    t.lineWidth = 3;
    t.beginPath();
    t.moveTo(-2, 14);
    t.lineTo(14, -2);
    t.moveTo(-8, 8);
    t.lineTo(8, -8);
    t.moveTo(4, 20);
    t.lineTo(20, 4);
    t.stroke();
    this.hatch = this.ctx.createPattern(tile, "repeat");
    return this.hatch;
  }

  // draws the lane at a position in beats. in scroll mode this is called every frame while the piece runs
  draw(positionBeats: number): void {
    this.lastPosition = positionBeats;
    const key = `${this.mode}|${this.mode === "scroll" ? positionBeats.toFixed(4) : `${this.page.from}-${this.page.to}`}|${this.width}x${this.height}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const { ctx } = this;
    const c = this.colours;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = c.bed;
    ctx.fillRect(0, 0, this.width, this.height);

    const hitY = this.height - 4;
    const from = this.mode === "scroll" ? positionBeats : this.page.from;
    const span = this.mode === "scroll" ? this.lookBeats : this.page.to - this.page.from;
    const ppb = (hitY - 4) / span;
    const scale = this.width / this.total;
    const yOf = (beat: number): number => hitY - (beat - from) * ppb;

    // bar lines and beat lines
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = c.paper;
    const firstBeat = Math.floor(from);
    for (let b = firstBeat; b <= from + span + 1; b++) {
      const y = Math.round(yOf(b)) + 0.5;
      if (y < 0 || y > hitY) continue;
      ctx.globalAlpha = b % this.beatsPerBar === 0 ? 0.55 : 0.18;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const hatch = this.hatchPattern();
    // a long piece has thousands of notes, so the loop starts at the first one that could still be on screen
    let lo = 0;
    let hi = this.notes.length;
    const earliest = from - this.longest - 0.01;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.notes[mid]?.startBeat ?? 0) < earliest) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.startBeat > from + span + 0.01) break;
      const bottom = yOf(n.startBeat);
      const top = Math.min(bottom - 6, yOf(n.startBeat + n.beats));
      // a note that has fully passed the hit line is gone
      if (this.mode === "scroll" && top > hitY) continue;
      if (bottom < 0) continue;
      const box = keyBox(n.note, this.lowest);
      const inset = box.black ? 0.06 : 0.12;
      const x = (box.x + inset) * scale;
      const w = Math.max(4, (box.width - inset * 2) * scale);
      const y = Math.max(0, top);
      const h = Math.min(hitY, bottom) - y;
      if (h <= 0) continue;
      const colour = n.hand === "right" ? c.right : c.left;
      const finished = this.done.has(n.index);
      if (finished) {
        // a note already played is an outline only
        ctx.lineWidth = 2;
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.6;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.globalAlpha = 1;
        continue;
      }
      // the left hand is drawn at 70 per cent as well as hatched, the same step as the hub's bar
      ctx.globalAlpha = n.hand === "left" ? 0.7 : 1;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, w, h);
      if (n.hand === "left" && hatch) {
        ctx.fillStyle = hatch;
        ctx.fillRect(x, y, w, h);
      }
      ctx.globalAlpha = 1;
      const isCurrent = this.current.has(n.index);
      ctx.lineWidth = isCurrent ? 4 : 2;
      ctx.strokeStyle = isCurrent ? c.paper : c.ink;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }

    // the hit line, where a note is due
    ctx.fillStyle = c.paper;
    ctx.fillRect(0, hitY, this.width, 4);
  }
}
