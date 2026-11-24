// the product rules: patterns this product has decided against, from section 4.2 of the specification.
// each rule carries examples that must and must not match, so a rule cannot go quiet without a test noticing.

import { scanCss, type CssRule } from "../../src/styles/css-scan.ts";

export type Kind = "css" | "ts" | "html" | "json";

export interface SourceFile {
  path: string;
  kind: Kind;
  text: string;
}

export interface Violation {
  rule: string;
  file: string;
  line: number;
  excerpt: string;
}

export interface Example {
  kind: Kind;
  text: string;
  // set when the example stands in for tokens.css, where colour literals are allowed
  path?: string;
}

export interface Rule {
  id: string;
  why: string;
  kinds: Kind[];
  check: (file: SourceFile) => Omit<Violation, "rule" | "file">[];
  bad: Example[];
  good: Example[];
}

export const TOKENS_PATH = "src/styles/tokens.css";

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;
const excerptOf = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 120);

// replaces comments with spaces so line numbers survive and strings are left alone
export function stripCodeComments(text: string): string {
  const pattern = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return text.replace(pattern, (match, str: string | undefined) =>
    str !== undefined ? match : match.replace(/[^\n]/g, " "),
  );
}

export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

function cssRules(file: SourceFile): CssRule[] {
  return file.kind === "css" ? scanCss(file.text) : [];
}

function segments(selector: string): string[] {
  return (selector.match(/[a-z0-9]+/gi) ?? []).map((s) => s.toLowerCase());
}

const LIGHT_WORDS = ["key", "keys", "led", "leds", "light", "lights", "rail"];
const hasAny = (selector: string, words: string[]): boolean => segments(selector).some((s) => words.includes(s));

function hit(rule: CssRule, text: string): Omit<Violation, "rule" | "file"> {
  return { line: rule.line, excerpt: excerptOf(`${rule.selector} { ${text} }`) };
}

// every comma separated part of a value
const parts = (value: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of value) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
};

const SIZE_TOKEN = /^(-?\d*\.?\d+)(px|rem|em|%|pt|vw|vh|ch|ex|cap|svw|svh|dvh|vmin|vmax)$/i;
const SIZE_KEYWORDS = /\b(xx-small|x-small|small|smaller|medium|large|x-large|xx-large|larger)\b/i;

// true when a font-size value can be smaller than 1rem or is set in px
export function badFontSize(value: string): boolean {
  const v = value.trim();
  if (v === "" || /^(inherit|initial|unset|revert|revert-layer)$/i.test(v)) return false;
  if (SIZE_KEYWORDS.test(v)) return true;
  const plain = SIZE_TOKEN.exec(v);
  if (plain?.[1] && plain[2]) {
    const n = parseFloat(plain[1]);
    const unit = plain[2].toLowerCase();
    if (unit === "px" || unit === "pt") return true;
    if (unit === "rem" || unit === "em") return n < 1;
    if (unit === "%") return n < 100;
    return false;
  }
  // calc(), clamp(), min() and max() may hide a px figure
  return /\d\s*(px|pt)\b/i.test(v);
}

const COLOUR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const HEX_ANY = /#[0-9a-f]{3,8}(?![\w-])/i;
const NAMED = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);
const COLOUR_PROPS = /^(color|background|background-color|border|border-(top|right|bottom|left|block|inline)(-[a-z]+)?-color|border-color|border-(top|right|bottom|left|block|inline)|outline|outline-color|fill|stroke|box-shadow|text-decoration|text-decoration-color|caret-color|accent-color|column-rule|column-rule-color|scrollbar-color|text-shadow|text-emphasis-color)$/;

function colourLiteralInValue(prop: string, value: string): boolean {
  const v = value.replace(/url\([^)]*\)/gi, "").replace(/var\([^)]*\)/gi, "");
  if (HEX_ANY.test(v) || COLOUR_FN.test(v)) return true;
  if (COLOUR_PROPS.test(prop)) {
    return (v.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => NAMED.has(w));
  }
  return false;
}

function shadowBlurred(value: string): boolean {
  for (const shadow of parts(value)) {
    if (/^none$/i.test(shadow)) continue;
    const withoutColour = shadow.replace(/(rgba?|hsla?|color-mix|var)\([^)]*(\([^)]*\))?[^)]*\)/gi, " ").replace(/#[0-9a-f]+/gi, " ");
    const lengths = withoutColour.match(/-?\d*\.?\d+(px|rem|em)?/gi) ?? [];
    if (lengths.length >= 3 && parseFloat(lengths[2] ?? "0") !== 0) return true;
  }
  return false;
}

// finds the innermost function that encloses an index, with its header text
function enclosingFunction(code: string, index: number): string | null {
  const stack: string[] = [];
  let headerStart = 0;
  for (let i = 0; i < index; i++) {
    const c = code.charAt(i);
    if (c === "{") {
      stack.push(code.slice(headerStart, i));
      headerStart = i + 1;
    } else if (c === "}") {
      stack.pop();
      headerStart = i + 1;
    } else if (c === ";") {
      headerStart = i + 1;
    }
  }
  const FUNCTION_HEADER = /=>\s*$|\bfunction\b[^{]*\)[^)]*$|^\s*(?:(?:public|private|protected|static|async|override)\s+)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^{=]+)?$/;
  for (let i = stack.length - 1; i >= 0; i--) {
    const header = stack[i] ?? "";
    if (FUNCTION_HEADER.test(header.trim())) return header;
  }
  return null;
}

const HANDLER_HEADER =
  /\b(on[A-Z]\w*|handle\w*|\w+Handler|\w+Listener)\b|\((?:[^)]*[,(\s])?(?:e|ev|evt|event|msg|message)\b[^)]*\)\s*(?::[^=]*)?(=>)?\s*$|\b\w*Event\b/;

const LIVE_REGION = /\baria-live\s*=|\brole\s*=\s*["'](status|log|alert)["']/i;
const PER_NOTE_NAME = /\b(id|class|data-[\w-]+)\s*=\s*["'][^"']*(note|feedback|step|next|beat|timing|score|key)[^"']*["']/i;

export const RULES: Rule[] = [
  {
    id: "font-size-floor",
    why: "The floor is 16 px and sizes follow the player's text setting, so nothing is under 1rem and nothing is in px",
    kinds: ["css", "html", "ts"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        for (const d of rule.declarations) {
          if (d.prop === "font-size" && badFontSize(d.value)) out.push(hit(rule, `font-size: ${d.value}`));
          if (d.prop === "font") {
            const size = d.value.split(/\s+/).map((t) => t.split("/")[0] ?? "").find((t) => SIZE_TOKEN.test(t));
            if (size && badFontSize(size)) out.push(hit(rule, `font: ${d.value}`));
          }
          if (file.path === TOKENS_PATH && /^--size-/.test(d.prop) && badFontSize(d.value)) {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          }
        }
      }
      if (file.kind !== "css") {
        const text = file.kind === "html" ? stripHtmlComments(file.text) : stripCodeComments(file.text);
        for (const m of text.matchAll(/font-?size["']?\s*[:=]\s*["'`]?\s*([^;"'`}\n,]+)/gi)) {
          if (m[1] && badFontSize(m[1])) out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: "p { font-size: 14px; }" },
      { kind: "css", text: "small { font-size: 0.875rem; }" },
      { kind: "css", text: "p { font: 12px/1.4 sans-serif; }" },
      { kind: "css", text: "p { font-size: calc(10px + 1vw); }" },
      { kind: "css", text: "p { font-size: smaller; }" },
      { kind: "html", text: '<p style="font-size: 13px">x</p>' },
    ],
    good: [
      { kind: "css", text: "p { font-size: 1rem; }" },
      { kind: "css", text: "p { font-size: var(--size-body); }" },
      { kind: "css", text: "h1 { font-size: 2.5rem; }" },
      { kind: "css", text: "p { font-size: inherit; }" },
    ],
  },
  {
    id: "colour-literal",
    why: "Every colour must be a measured token, so a hex, rgb or hsl value outside tokens.css is not allowed",
    kinds: ["css", "html", "ts"],
    check(file) {
      if (file.path === TOKENS_PATH) return [];
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        for (const d of rule.declarations) {
          if (d.prop.startsWith("--") ? colourLiteralInValue("color", d.value) : colourLiteralInValue(d.prop, d.value)) {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          }
        }
      }
      if (file.kind !== "css") {
        const text = file.kind === "html" ? stripHtmlComments(file.text) : stripCodeComments(file.text);
        for (const m of text.matchAll(/#[0-9a-f]{6}(?:[0-9a-f]{2})?(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab)\(\s*[\d.%]/gi)) {
          out.push({ line: lineOf(text, m.index), excerpt: excerptOf(text.slice(m.index, m.index + 40)) });
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: "a { color: #ff0000; }" },
      { kind: "css", text: "a { background: rgb(0 0 0); }" },
      { kind: "css", text: "a { border: 1px solid red; }" },
      { kind: "css", text: "a { color: color-mix(in srgb, var(--text) 50%, transparent); }" },
      { kind: "html", text: '<meta name="theme-color" content="#f7f7f5">' },
      { kind: "ts", text: 'el.style.color = "#ffb000";' },
    ],
    good: [
      { kind: "css", text: "a { color: var(--text); background: var(--canvas); }" },
      { kind: "css", text: "a { color: CanvasText; border: 2px solid ButtonText; }" },
      { kind: "css", text: "a { background: transparent; outline-color: currentColor; }" },
      { kind: "css", text: ":root { --text: #0e0e12; }", path: TOKENS_PATH },
      { kind: "html", text: '<a href="#main">Skip</a>' },
      { kind: "css", text: "a { background: url(#shape); }" },
    ],
  },
  {
    id: "outline-removed",
    why: "Focus is always visible, so an outline is never removed without a replacement in the same rule",
    kinds: ["css"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        const removes = rule.declarations.some(
          (d) => (d.prop === "outline" && /^(none|0|0px)$/i.test(d.value)) || (d.prop === "outline-style" && d.value === "none"),
        );
        if (!removes) continue;
        const replaced = rule.declarations.some((d) => d.prop === "box-shadow" && !/^none$/i.test(d.value));
        // the :focus:not(:focus-visible) pattern removes the ring only for pointer focus
        if (replaced || /:not\(\s*:focus-visible\s*\)/.test(rule.selector)) continue;
        out.push(hit(rule, "outline removed"));
      }
      return out;
    },
    bad: [
      { kind: "css", text: "button:focus { outline: none; }" },
      { kind: "css", text: "a:focus-visible { outline: 0; }" },
    ],
    good: [
      { kind: "css", text: "button:focus { outline: none; box-shadow: 0 0 0 3px var(--focus); }" },
      { kind: "css", text: "button:focus:not(:focus-visible) { outline: none; }" },
      { kind: "css", text: "a:focus-visible { outline: 3px solid var(--focus); }" },
    ],
  },
  {
    id: "zoom-blocked",
    why: "Zoom is never blocked, so a viewport tag may not stop scaling",
    kinds: ["html", "ts"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      const text = stripHtmlComments(file.text);
      for (const m of text.matchAll(/user-scalable\s*=\s*(no|0)\b|maximum-scale\s*=/gi)) {
        out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
      }
      return out;
    },
    bad: [
      { kind: "html", text: '<meta name="viewport" content="width=device-width, user-scalable=no">' },
      { kind: "html", text: '<meta name="viewport" content="width=device-width, maximum-scale=1">' },
    ],
    good: [{ kind: "html", text: '<meta name="viewport" content="width=device-width, initial-scale=1.0">' }],
  },
  {
    id: "transition-feedback",
    why: "Feedback is instant, so there is no transition on all properties and none on a key or a light",
    kinds: ["css"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        for (const d of rule.declarations) {
          if (!d.prop.startsWith("transition")) continue;
          if (/\ball\b/i.test(d.value) && d.prop !== "transition-duration" && d.prop !== "transition-delay") {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          } else if (hasAny(rule.selector, LIGHT_WORDS)) {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          }
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: ".card { transition: all 150ms; }" },
      { kind: "css", text: ".key { transition: background 80ms linear; }" },
      { kind: "css", text: ".led.next { transition: opacity 120ms; }" },
    ],
    good: [
      { kind: "css", text: ".card { transition: opacity var(--duration-hover); }" },
      { kind: "css", text: ".keyboard-help { transition: none; }" },
    ],
  },
  {
    id: "soft-edge",
    why: "Soft edges are harder to find, so there is no blur, backdrop filter or blurred shadow",
    kinds: ["css"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        for (const d of rule.declarations) {
          const blurFn = /\bblur\(/i.test(d.value) || /drop-shadow\(/i.test(d.value);
          if (d.prop === "backdrop-filter" || d.prop === "-webkit-backdrop-filter" || blurFn) {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          } else if ((d.prop === "box-shadow" || d.prop === "text-shadow") && shadowBlurred(d.value)) {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          }
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: ".a { box-shadow: 0 0 10px 3px var(--accent); }" },
      { kind: "css", text: ".a { backdrop-filter: saturate(2); }" },
      { kind: "css", text: ".a { filter: blur(4px); }" },
      { kind: "css", text: ".a { text-shadow: 0 1px 2px var(--text); }" },
    ],
    good: [
      { kind: "css", text: ".a { box-shadow: 0 0 0 2px var(--focus-gap); }" },
      { kind: "css", text: ".a { box-shadow: none; }" },
    ],
  },
  {
    id: "gradient",
    why: "A light, a key or text has a crisp edge, so it never carries a gradient",
    kinds: ["css"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        const gradient = rule.declarations.find((d) => /gradient\(/i.test(d.value));
        if (!gradient) continue;
        const clipsText = rule.declarations.some((d) => /background-clip$/.test(d.prop) && /text/i.test(d.value));
        if (clipsText || hasAny(rule.selector, [...LIGHT_WORDS, "text"])) {
          out.push(hit(rule, `${gradient.prop}: ${gradient.value}`));
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: ".led { background: radial-gradient(var(--light-right), transparent); }" },
      { kind: "css", text: ".title { background: linear-gradient(var(--text), var(--accent)); background-clip: text; }" },
    ],
    good: [{ kind: "css", text: ".hero { background: linear-gradient(var(--canvas), var(--surface)); }" }],
  },
  {
    id: "uppercase",
    why: "Capitals remove word shape, so uppercase is for a short label only and each use is listed with a reason",
    kinds: ["css"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        for (const d of rule.declarations) {
          if (d.prop === "text-transform" && /uppercase/i.test(d.value)) out.push(hit(rule, `${d.prop}: ${d.value}`));
        }
      }
      return out;
    },
    bad: [{ kind: "css", text: "h2 { text-transform: uppercase; }" }],
    good: [{ kind: "css", text: "h2 { text-transform: none; }" }],
  },
  {
    id: "infinite-animation",
    why: "Loops need a reason and a stop, so an infinite animation is allowed only on the lane and the beat indicator",
    kinds: ["css", "ts"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const rule of cssRules(file)) {
        for (const d of rule.declarations) {
          if (d.prop.startsWith("animation") && /\binfinite\b/i.test(d.value) && !hasAny(rule.selector, ["lane", "beat"])) {
            out.push(hit(rule, `${d.prop}: ${d.value}`));
          }
        }
      }
      if (file.kind === "ts") {
        const text = stripCodeComments(file.text);
        for (const m of text.matchAll(/iterations\s*:\s*(Infinity|Number\.POSITIVE_INFINITY)/g)) {
          out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: ".spinner { animation: spin 1s linear infinite; }" },
      { kind: "ts", text: "el.animate(frames, { duration: 1000, iterations: Infinity });" },
    ],
    good: [
      { kind: "css", text: ".lane { animation: scroll 1s linear infinite; }" },
      { kind: "css", text: ".beat-indicator { animation-iteration-count: infinite; }" },
      { kind: "css", text: ".toast { animation: fade 200ms 1; }" },
    ],
  },
  {
    id: "smooth-scroll",
    why: "Smooth scrolling breaks screen magnifiers and find in page",
    kinds: ["css", "ts", "html", "json"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      const libs = /\b(lenis|locomotive-scroll|smooth-scroll|smoothscroll|scrollsmoother|@studio-freight\/lenis)\b/i;
      if (file.kind === "css") {
        for (const rule of cssRules(file)) {
          for (const d of rule.declarations) {
            if (d.prop === "scroll-behavior" && /smooth/i.test(d.value)) out.push(hit(rule, `${d.prop}: ${d.value}`));
          }
        }
      } else {
        const text = file.kind === "ts" ? stripCodeComments(file.text) : file.text;
        for (const m of text.matchAll(/behavior\s*:\s*["']smooth["']|["']lenis["']|from\s+["'][^"']*(lenis|locomotive-scroll|smooth-scroll|smoothscroll)[^"']*["']/gi)) {
          out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
        }
        if (file.kind === "json") {
          for (const m of text.matchAll(new RegExp(`"${libs.source}"\\s*:`, "gi"))) {
            out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
          }
        }
      }
      return out;
    },
    bad: [
      { kind: "css", text: "html { scroll-behavior: smooth; }" },
      { kind: "ts", text: 'import Lenis from "lenis";' },
      { kind: "ts", text: 'el.scrollIntoView({ behavior: "smooth" });' },
      { kind: "json", text: '{ "dependencies": { "lenis": "^1.0.0" } }' },
    ],
    good: [
      { kind: "css", text: "html { scroll-behavior: auto; }" },
      { kind: "ts", text: 'el.scrollIntoView({ behavior: "instant" });' },
    ],
  },
  {
    id: "canvas-text",
    why: "Text is never drawn on a canvas, because it cannot be zoomed, restyled or read aloud",
    kinds: ["ts"],
    check(file) {
      const text = stripCodeComments(file.text);
      return [...text.matchAll(/\.(fillText|strokeText)\s*\(/g)].map((m) => ({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) }));
    },
    bad: [{ kind: "ts", text: 'ctx.fillText("C4", 10, 10);' }],
    good: [{ kind: "ts", text: "ctx.fillRect(0, 0, 10, 10); // fillText is not used" }],
  },
  {
    id: "live-region-per-note",
    why: "A live region that changes on every note is unusable, so the regions that follow notes are listed and removed by stage 4",
    kinds: ["html"],
    check(file) {
      const text = stripHtmlComments(file.text);
      return [...text.matchAll(/<[a-z][^>]*>/gi)]
        .filter((m) => LIVE_REGION.test(m[0]) && PER_NOTE_NAME.test(m[0]))
        .map((m) => ({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) }));
    },
    bad: [
      { kind: "html", text: '<p id="next-note" aria-live="polite">-</p>' },
      { kind: "html", text: '<p id="feedback" role="status">x</p>' },
    ],
    good: [
      { kind: "html", text: '<p id="status" role="status" aria-live="polite">Connected</p>' },
      { kind: "html", text: '<p id="next-note">C4</p>' },
    ],
  },
  {
    id: "raw-protocol-value",
    why: "Status is written in words, so a protocol value such as usb_midi is never shown",
    kinds: ["ts", "html"],
    check(file) {
      const text = file.kind === "ts" ? stripCodeComments(file.text) : stripHtmlComments(file.text);
      return [...text.matchAll(/\b(usb_midi|ble_midi|midi_jack)\b/g)].map((m) => ({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) }));
    },
    bad: [
      { kind: "ts", text: 'status.textContent = "source: usb_midi";' },
      { kind: "html", text: "<p>ble_midi</p>" },
    ],
    good: [{ kind: "ts", text: 'status.textContent = "Connected over USB";' }],
  },
  {
    id: "title-only-name",
    why: "A title attribute is not reliably exposed, so it is never the only name of a control",
    kinds: ["html", "ts"],
    check(file) {
      const text = file.kind === "html" ? stripHtmlComments(file.text) : stripCodeComments(file.text);
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const m of text.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        const attrs = m[2] ?? "";
        // tags are removed until none are left, so a nested one such as "<<b>script>" cannot survive a single pass
        let inner = (m[3] ?? "").replace(/<svg[\s\S]*?<\/svg>/gi, "");
        for (let before = ""; before !== inner; ) {
          before = inner;
          inner = inner.replace(/<[^>]*>/g, "");
        }
        inner = inner.trim();
        if (/\btitle\s*=/i.test(attrs) && !/\baria-label(ledby)?\s*=/i.test(attrs) && inner === "") {
          out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
        }
      }
      return out;
    },
    bad: [{ kind: "html", text: '<button title="Play"><svg></svg></button>' }],
    good: [
      { kind: "html", text: '<button aria-label="Play" title="Play"><svg></svg></button>' },
      { kind: "html", text: '<button title="More">Play</button>' },
    ],
  },
  {
    id: "emoji",
    why: "Emoji render differently on each system and screen readers read their names aloud",
    kinds: ["css", "ts", "html"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const m of file.text.matchAll(/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}️]/gu)) {
        out.push({ line: lineOf(file.text, m.index), excerpt: `U+${(m[0].codePointAt(0) ?? 0).toString(16).toUpperCase()}` });
      }
      return out;
    },
    bad: [
      { kind: "html", text: "<p>Well done \u{1F389}</p>" },
      { kind: "ts", text: 'const label = "☀️";' },
    ],
    good: [{ kind: "html", text: "<p>C ♯ and B ♭</p>" }],
  },
  {
    id: "implicit-locale",
    why: "Dates and numbers must be predictable, so a formatter always gets an explicit locale",
    kinds: ["ts"],
    check(file) {
      const text = stripCodeComments(file.text);
      const out: Omit<Violation, "rule" | "file">[] = [];
      const patterns = [
        /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b|\{)/g,
        /Intl\.\w+\(\s*(?:\)|undefined\b|\{)/g,
      ];
      for (const p of patterns) {
        for (const m of text.matchAll(p)) out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
      }
      return out;
    },
    bad: [
      { kind: "ts", text: "n.toLocaleString();" },
      { kind: "ts", text: "d.toLocaleDateString(undefined, { month: 'long' });" },
      { kind: "ts", text: "new Intl.NumberFormat({ style: 'percent' });" },
    ],
    good: [
      { kind: "ts", text: 'n.toLocaleString("en-GB");' },
      { kind: "ts", text: 'new Intl.DateTimeFormat("en-GB", { month: "long" });' },
    ],
  },
  {
    id: "now-in-handler",
    why: "Timing uses the event's own timestamp, so performance.now() is not read inside an input handler",
    kinds: ["ts"],
    check(file) {
      const code = stripCodeComments(file.text);
      const out: Omit<Violation, "rule" | "file">[] = [];
      for (const m of code.matchAll(/performance\.now\s*\(\)/g)) {
        const header = enclosingFunction(code, m.index);
        const lineStart = code.lastIndexOf("\n", m.index) + 1;
        const sameLine = code.slice(lineStart, m.index);
        const inlineArrow = /\(\s*(e|ev|evt|event)\b[^)]*\)\s*=>/.test(sameLine);
        if ((header !== null && HANDLER_HEADER.test(header)) || inlineArrow) {
          out.push({ line: lineOf(code, m.index), excerpt: excerptOf(code.slice(lineStart, m.index + 20)) });
        }
      }
      return out;
    },
    bad: [
      { kind: "ts", text: "function onNote(note: number): void {\n  const t = performance.now();\n}" },
      { kind: "ts", text: "input.onmidimessage = (event) => {\n  stamp(performance.now());\n};" },
      { kind: "ts", text: "window.addEventListener('keydown', (e: KeyboardEvent) => { go(performance.now()); });" },
    ],
    good: [
      { kind: "ts", text: "function tick(): number {\n  return performance.now();\n}" },
      { kind: "ts", text: "input.onmidimessage = (event) => {\n  stamp(event.timeStamp);\n};" },
    ],
  },
  {
    id: "timer-places-note",
    why: "Notes are scheduled on the master clock, so setTimeout and setInterval are not used to place a note in time",
    kinds: ["ts"],
    check(file) {
      const code = stripCodeComments(file.text);
      if (!/note/i.test(code)) return [];
      return [...code.matchAll(/\b(?:window\.)?(setTimeout|setInterval)\s*\(/g)].map((m) => ({
        line: lineOf(code, m.index),
        excerpt: excerptOf(code.slice(code.lastIndexOf("\n", m.index) + 1, m.index + 30)),
      }));
    },
    bad: [{ kind: "ts", text: "setTimeout(() => onNote(60, true), at);" }],
    good: [
      { kind: "ts", text: "setTimeout(() => hideToast(), 4000);" },
      { kind: "ts", text: "clock.schedule(note, at);" },
    ],
  },
  {
    id: "effect-library",
    why: "WebGL, tween and effect libraries were decided against in sections 3.4 and 3.10",
    kinds: ["ts", "json", "html"],
    check(file) {
      const out: Omit<Violation, "rule" | "file">[] = [];
      const names = "three|pixi\\.js|@pixi/[\\w-]+|gsap|animejs|anime\\.js|framer-motion|motion|popmotion|@react-spring/[\\w-]+|react-spring|@tweenjs/tween\\.js|tween\\.js|regl|babylonjs|@babylonjs/[\\w-]+|p5|matter-js|lottie-web|@react-three/[\\w-]+|aos|scrollreveal";
      const text = file.kind === "ts" ? stripCodeComments(file.text) : file.text;
      const patterns =
        file.kind === "json"
          ? [new RegExp(`"(${names})"\\s*:`, "g")]
          : [
              new RegExp(`(?:from|import|require)\\s*\\(?\\s*["'](${names})(?:/[^"']*)?["']`, "g"),
              /getContext\(\s*["'](webgl2?|experimental-webgl)["']/g,
            ];
      for (const p of patterns) {
        for (const m of text.matchAll(p)) out.push({ line: lineOf(text, m.index), excerpt: excerptOf(m[0]) });
      }
      return out;
    },
    bad: [
      { kind: "ts", text: 'import gsap from "gsap";' },
      { kind: "ts", text: 'const gl = canvas.getContext("webgl2");' },
      { kind: "json", text: '{ "dependencies": { "three": "^0.170.0" } }' },
    ],
    good: [
      { kind: "ts", text: 'const ctx = canvas.getContext("2d");' },
      { kind: "json", text: '{ "devDependencies": { "vite": "^8.0.0" } }' },
    ],
  },
];

export function fileFromExample(example: Example): SourceFile {
  return { path: example.path ?? `example.${example.kind}`, kind: example.kind, text: example.text };
}

export function scanFile(file: SourceFile): Violation[] {
  const out: Violation[] = [];
  for (const rule of RULES) {
    if (!rule.kinds.includes(file.kind)) continue;
    for (const v of rule.check(file)) out.push({ rule: rule.id, file: file.path, ...v });
  }
  return out;
}

// a rule check that may only be applied to one rule, used by the examples
export function scanWith(rule: Rule, file: SourceFile): Violation[] {
  return rule.kinds.includes(file.kind) ? rule.check(file).map((v) => ({ rule: rule.id, file: file.path, ...v })) : [];
}

export interface PairUse {
  fg: string;
  bg: string;
}

// a rule that sets both a text colour and a background from tokens must use a listed pairing
export function pairUsage(file: SourceFile): { fg: string; bg: string; line: number; excerpt: string }[] {
  const out: { fg: string; bg: string; line: number; excerpt: string }[] = [];
  for (const rule of cssRules(file)) {
    const fg = rule.declarations.find((d) => d.prop === "color");
    const bg = rule.declarations.find((d) => d.prop === "background" || d.prop === "background-color");
    const fgToken = /^var\(\s*(--[\w-]+)\s*\)$/.exec(fg?.value ?? "")?.[1];
    const bgToken = /^var\(\s*(--[\w-]+)\s*\)$/.exec(bg?.value ?? "")?.[1];
    if (fgToken && bgToken) out.push({ fg: fgToken, bg: bgToken, line: rule.line, excerpt: excerptOf(rule.selector) });
  }
  return out;
}
