// the specimen page: type, colour, lights, focus and icons, with every figure measured in the browser.
// it reads the same tokens.css and tokens.pairs.json as the tests, so a number here cannot differ from a test.

import "../styles/fonts/fonts.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "./specimen.css";

import { ICONS, iconMarkup, type IconName } from "../icons/index.ts";
import { VISIONS, contrast, contrastHex, deltaE, normaliseHex, parseHex, round2, type Vision } from "../styles/colour.ts";
import { scanCss } from "../styles/css-scan.ts";
import lights from "../styles/lights.json";
import pairsFile from "../styles/tokens.pairs.json";
import tokensCss from "../styles/tokens.css?raw";
import {
  SET_NAMES,
  evaluatePairs,
  minimumFor,
  parseTokens,
  specFigure,
  tokenValue,
  type PairsFile,
  type Role,
  type SetName,
} from "../styles/tokens-model.ts";

const pairs = pairsFile as unknown as PairsFile;
const model = parseTokens(tokensCss);
const root = document.documentElement;

type Choice = { value: string; label: string; icon?: IconName };

const THEMES: Choice[] = [
  { value: "system", label: "System", icon: "system" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];
const CONTRASTS: Choice[] = [
  { value: "standard", label: "Standard" },
  { value: "more", label: "More" },
];
const DISTANCES: Choice[] = [
  { value: "near", label: "Near" },
  { value: "stand", label: "Stand" },
  { value: "far", label: "Far" },
];

const state = { theme: "system", contrast: "standard", distance: "near" };

const SET_LABEL: Record<SetName, string> = {
  light: "Light",
  dark: "Dark",
  "light-more": "Light, more contrast",
  "dark-more": "Dark, more contrast",
};

const ROLE_LABEL: Record<Role, string> = { body: "Body", muted: "Muted", mark: "Mark", decorative: "Decorative" };

const SIZE_ROWS: { token: string; name: string; sample: string }[] = [
  { token: "--size-h1", name: "Heading 1, site", sample: "Song made visible" },
  { token: "--size-h2", name: "Heading 2, site", sample: "How the lights work" },
  { token: "--size-h3", name: "Heading 3, site and lead", sample: "The next note is lit" },
  { token: "--size-lead", name: "Lead paragraph", sample: "The light is on the key itself, not on a screen." },
  { token: "--size-body", name: "Body", sample: "Practise the right hand slowly. Melody mode waits for each right note." },
  { token: "--size-floor", name: "Floor, nothing smaller", sample: "Labels and captions are never under 16 px." },
  { token: "--size-app-h1", name: "Heading 1, app", sample: "Ode to Joy" },
  { token: "--size-app-h2", name: "Heading 2, app", sample: "Practice summary" },
  { token: "--size-app-h3", name: "Heading 3, app", sample: "Right hand" },
];

const SPACE_TOKENS = ["--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8", "--space-12", "--space-16", "--space-24"];

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// computed values are read many times per render, so they are kept until the next render
const cache = new Map<string, string>();
const css = (name: string): string => {
  let v = cache.get(name);
  if (v === undefined) {
    v = normaliseHex(getComputedStyle(root).getPropertyValue(name));
    cache.set(name, v);
  }
  return v;
};
const remBase = (): number => parseFloat(getComputedStyle(root).fontSize);

function toRem(value: string): number {
  return value.endsWith("rem") ? parseFloat(value) : parseFloat(value) / remBase();
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

function faceStatus(): string[] {
  return [...document.fonts].map((f) => {
    const range = f.unicodeRange === "U+0-10FFFF" ? "" : ` (signs ${f.unicodeRange})`;
    return `${f.family.replaceAll('"', "")}${range}: ${f.status}`;
  });
}

function activeSet(): SetName {
  const canvas = css("--canvas").toLowerCase();
  const text = css("--text").toLowerCase();
  const found = SET_NAMES.find((s) => tokenValue(model, s, "--canvas") === canvas && tokenValue(model, s, "--text") === text);
  return found ?? "light";
}

function status(passes: boolean, minimum: number | null): string {
  if (minimum === null) return `<span class="status">${iconMarkup("info")}No minimum</span>`;
  return passes
    ? `<span class="status">${iconMarkup("tick")}Passes</span>`
    : `<span class="status">${iconMarkup("close")}Fails</span>`;
}

function table(head: string[], rows: string[][], label: string): string {
  const th = head.map((h) => `<th scope="col">${h}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("");
  return `<div class="table-frame" role="region" aria-label="${esc(label)}" tabindex="0"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function section(id: string, title: string, intro: string, body: string): string {
  return `<section id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${title}</h2><p>${intro}</p>${body}</section>`;
}

// the figures for the three distance settings are read from tokens.css, because only one applies at a time
function distanceRows(): string[][] {
  const rules = scanCss(tokensCss);
  const near = Object.fromEntries(
    rules.filter((r) => r.selector === ":root" && r.set === null && r.context.length === 0).flatMap((r) => r.declarations.map((d) => [d.prop, d.value])),
  ) as Record<string, string>;
  const pick = (name: string): Record<string, string> =>
    Object.fromEntries(rules.filter((r) => r.selector === `:root[data-distance="${name}"]`).flatMap((r) => r.declarations.map((d) => [d.prop, d.value])));
  const sets: [string, Record<string, string>][] = [
    ["Near", near],
    ["Stand", { ...near, ...pick("stand") }],
    ["Far", { ...near, ...pick("far") }],
  ];
  const px = (v: string | undefined): string => (v === undefined ? "none" : `${fmt(toRem(v) * remBase())} px`);
  return sets.map(([name, t]) => [
    name,
    t["--distance-factor"] ?? "1",
    px(t["--practice-support"]),
    px(t["--practice-counter"]),
    px(t["--practice-step-note"]),
    px(t["--practice-next-note"]),
    px(t["--practice-transport"]),
  ]);
}

function typeSection(): string {
  const scale = SIZE_ROWS.map((row) => {
    const rem = toRem(css(row.token));
    return `<div class="type-row">
      <p class="type-meta figure"><strong>${row.name}</strong>, <code>${row.token}</code>, ${fmt(rem)}rem, ${fmt(rem * remBase())} px</p>
      <p class="sample-line" style="font-size: var(${row.token}); font-weight: ${/h\d/.test(row.token) ? "var(--weight-bold)" : "inherit"}">${esc(row.sample)}</p>
    </div>`;
  }).join("");

  const weights = [
    ["400", "Regular. Body text on light."],
    ["450", "Body text on dark, set a little heavier so light text holds up."],
    ["700", "Bold. Weight carries emphasis. There are no italics."],
  ]
    .map(([w, note]) => `<p class="sample-line" style="font-weight: ${w}"><span class="figure">${w}</span> ${esc(note ?? "")}</p>`)
    .join("");

  const faces = faceStatus();

  return section(
    "type",
    "Type",
    "Atkinson Hyperlegible Next for all text and Atkinson Hyperlegible Mono for code. Sizes are in rem so the player's text setting always wins.",
    `<div class="grid">
      <div class="panel"><h3>Scale</h3>${scale}</div>
      <div class="grid grid-2">
        <div class="panel"><h3>Weights</h3>${weights}</div>
        <div class="panel">
          <h3>Figures that stay put</h3>
          <p class="sample-line figure" style="font-size: var(--size-lead)">Tabular: 1111 and 0000 are the same width.</p>
          <p class="sample-line" style="font-size: var(--size-lead); font-variant-numeric: proportional-nums">Proportional: 1111 and 0000 are not.</p>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h3>Real music signs</h3>
          <p class="glyphs" aria-label="C sharp 4, B flat 3, E natural 4">C&#x266F;4 B&#x266D;3 E&#x266E;4</p>
          <p class="note">The sharp, flat and natural signs come from a small file, because the text fonts do not have them.</p>
        </div>
        <div class="panel">
          <h3>Letters that must not blur</h3>
          <p class="confusables" aria-label="capital I, lower case l, one, capital O, zero, B, eight, C, G">Il1 O0 B8 CG</p>
          <p class="mono sample-line">Code and data: tempo = 96; note = "C&#x266F;4"</p>
        </div>
      </div>
      <div class="panel">
        <h3>Practice view scale</h3>
        <p>The Distance setting steps type, lights and targets up together. The transport targets are the specification's own figures and do not follow the factor exactly.</p>
        ${table(["Setting", "Factor", "Supporting text", "Counters", "Step card note", "Next note", "Transport target"], distanceRows(), "Practice view scale")}
        <p class="practice-sample" style="font-size: var(--practice-next-note); margin-block-start: var(--space-4)">C&#x266F;4</p>
        <p class="note">The note above is set at the current Distance setting. A real screen caps it at a third of the height.</p>
      </div>
      <div class="panel">
        <h3>Fonts loaded in this browser</h3>
        <p class="figure" id="font-status">${esc(faces.join(". ") || "Fonts load on first use.")}</p>
        <p class="note">Each face has a fallback built from Verdana or Courier New metrics, so lines do not move when the font arrives.</p>
      </div>
    </div>`,
  );
}

function colourSection(): string {
  const set = activeSet();
  const results = evaluatePairs(model, pairs).filter((r) => r.set === set);
  const rows = results.map((r) => {
    const fg = css(r.pair.fg);
    const bg = css(r.pair.bg);
    const ratio = contrastHex(fg, bg);
    const spec = specFigure(r.pair, set);
    const specCell =
      spec === undefined
        ? "Not in the spec"
        : round2(ratio) === spec
          ? `${spec.toFixed(2)}:1, matches`
          : `${spec.toFixed(2)}:1, differs`;
    const under7 = r.pair.role === "muted" && ratio < 7 ? " data-under-7" : "";
    return [
      `<code>${r.pair.fg}</code> on <code>${r.pair.bg}</code><br /><span class="note">${esc(r.pair.use)}</span>`,
      r.pair.role === "body" || r.pair.role === "muted"
        ? `<span class="sample"${under7} style="color: var(${r.pair.fg}); background: var(${r.pair.bg})">Aa 123</span>`
        : `<span class="sample-block" style="background: var(${r.pair.bg})"><span class="sample-bar" style="background: var(${r.pair.fg})"></span></span>`,
      `<span class="figure"><strong>${ratio.toFixed(2)}:1</strong></span>`,
      ROLE_LABEL[r.pair.role],
      r.minimum === null ? "None" : `<span class="figure">${r.minimum}:1</span>`,
      status(ratio >= (r.minimum ?? 0), r.minimum),
      specCell,
    ];
  });

  const palette = Object.keys({ ...model.sets[set] })
    .filter((n) => /^#[0-9a-f]{6}$/i.test(model.sets[set][n] ?? ""))
    .concat(Object.keys(model.global).filter((n) => /^#[0-9a-f]{6}$/i.test(model.global[n] ?? "")))
    .map(
      (name) => `<li class="chip"><span class="chip-fill" style="background: var(${name})"></span><span class="chip-name">${name}</span><span class="figure">${esc(css(name))}</span></li>`,
    )
    .join("");

  return section(
    "colour",
    "Colour",
    `The set in use is <strong>${SET_LABEL[set]}</strong>. Each row is one allowed pairing from <code>tokens.pairs.json</code>, measured now. A component may only use a pairing on this list.`,
    `<div class="grid">
      <div class="panel"><h3>Palette in use</h3><ul class="palette">${palette}</ul></div>
      <div class="panel">
        <h3>Measured contrast</h3>
        <p class="note">Body text aims for 7:1. Muted text and short labels need 4.5:1. Lines, marks and the focus ring need 3:1. Decorative pairs have no minimum and are never the only cue.</p>
        ${table(["Pairing", "Sample", "Ratio", "Role", "Needs", "Result", "Specification"], rows, "Measured contrast for the colour set in use")}
      </div>
    </div>`,
  );
}

function ratioOn(token: string, bg: string): string {
  return `${contrastHex(css(token), css(bg)).toFixed(2)}:1`;
}

function lightsSection(): string {
  const roleRows = lights.roles.map((r) => {
    const colour = r.token ? `<code>${r.token}</code><br /><span class="figure">${esc(css(r.token))}</span>` : "No colour";
    const ratio = r.token ? `<span class="figure">${ratioOn(r.token, "--rail")}</span>` : "None";
    const led = r.led ? `<span class="figure">${r.led.join(", ")}</span>` : esc((r as { ledNote?: string }).ledNote ?? "");
    return [esc(r.label), colour, ratio, esc(r.shape), esc(r.word), led, esc(r.timing)];
  });

  const fillRows = [
    ["Lit amber key beside a white key", ratioOn("--accent", "--key-white"), "Fails 3:1, so colour cannot carry it. Every lit key has an ink outline and a marker shape"],
    ["Ink outline against a white key", ratioOn("--key-ink", "--key-white"), "Carries the boundary of every lit key"],
    ["Left hand fill against a white key", ratioOn("--key-left-fill", "--key-white"), "Used with an ink outline and the letter L"],
    ["Wrong fill against a white key", ratioOn("--key-wrong-fill", "--key-white"), "Used with an ink outline and a cross"],
  ].map(([a, b, c]) => [esc(a ?? ""), `<span class="figure">${b}</span>`, esc(c ?? "")]);

  return section(
    "lights",
    "Lights and keys",
    "The rail is ink in every theme, as the real bar is, so amber keeps 11:1 even on paper. Each colour has a shape and a word, because the hands are the same lightness and are told apart by hue alone on the LEDs.",
    `<div class="grid">
      <div class="panel">
        <h3>On the rail</h3>
        <div class="rail" role="img" aria-label="Five light roles on the rail: a large disc, a large square, a small ring, a small hollow square and a cross">
          <span class="rail-item"><span class="light light-disc"></span>Next, right</span>
          <span class="rail-item"><span class="light light-square"></span>Next, left</span>
          <span class="rail-item"><span class="light light-ring"></span>Soon, right</span>
          <span class="rail-item"><span class="light light-hollow"></span>Soon, left</span>
          <span class="rail-item"><span class="light light-cross">${iconMarkup("close")}</span>Wrong</span>
        </div>
        <div class="keys" role="img" aria-label="Three keys: lit amber with an ink outline; left hand blue with the letter L; wrong with a cross">
          <span class="key key-lit">R1</span>
          <span class="key key-left">L2</span>
          <span class="key key-wrong">${iconMarkup("close")}</span>
        </div>
      </div>
      <div class="panel">
        <h3>Role map</h3>
        ${table(["Role", "Screen colour", "On the rail", "Shape on screen", "Word", "LED drive", "Timing"], roleRows, "Light role map")}
        <p class="note">LED values are nominal. They are tuned by eye on the real diffuser. The firmware's table is in <code>lights.json</code> beside the tokens.</p>
      </div>
      <div class="panel">
        <h3>Keys on screen</h3>
        ${table(["Pair", "Ratio", "Rule"], fillRows, "Key fills")}
      </div>
    </div>`,
  );
}

function visionSection(): string {
  const colour = (id: string): string => {
    const role = lights.roles.find((r) => r.id === id);
    const v = role?.token ? css(role.token) : "";
    return v;
  };
  const led = (id: string): [number, number, number] => {
    const v = lights.roles.find((r) => r.id === id)?.led;
    if (!v) throw new Error(`no LED value for ${id}`);
    return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  };
  const label = (id: string): string => lights.roles.find((r) => r.id === id)?.label ?? id;
  const min = lights.separation.minimum;

  const pairRows = (ids: string[], rgb: (id: string) => [number, number, number], kind: string): string[][] => {
    const rows: string[][] = [];
    ids.forEach((a, i) => {
      ids.slice(i + 1).forEach((b) => {
        const cells = VISIONS.map((v) => deltaE(rgb(a), rgb(b), v));
        const ok = cells.every((d) => d >= min);
        rows.push([
          `${kind}: ${esc(label(a))} and ${esc(label(b))}`,
          ...cells.map((d) => `<span class="figure">${d.toFixed(1)}</span>`),
          `<span class="status">${ok ? iconMarkup("tick") + "Clear" : iconMarkup("close") + "Too close"}</span>`,
        ]);
      });
    });
    return rows;
  };

  const refs = lights.reference.map((r) => {
    const cells = VISIONS.map((v: Vision) => {
      const d = deltaE(parseHex(r.a), parseHex(r.b), v);
      const spec = (r.spec as Partial<Record<Vision, number>>)[v];
      return spec === undefined ? `<span class="figure">${d.toFixed(1)}</span>` : `<span class="figure">${d.toFixed(1)}</span> <span class="note">(spec ${spec.toFixed(1)})</span>`;
    });
    return [esc(r.name), ...cells];
  });

  const hands = contrast(parseHex(colour("next-right")), parseHex(colour("next-left")));

  return section(
    "vision",
    "Colour vision",
    `Difference in CIELAB after simulating each kind of colour vision (Machado 2009). ${min} or more is treated as clearly different. The two hands measure ${hands.toFixed(2)}:1 in luminance, so on screen they also differ by shape and letter.`,
    `<div class="grid">
      <div class="panel">
        <h3>Every pair of lights that can appear together</h3>
        ${table(["Pair", "Typical", "Protan", "Deutan", "Tritan", "Result"], [...pairRows(lights.separation.screen, (id) => parseHexTuple(colour(id)), "Screen"), ...pairRows(lights.separation.led, led, "LED")], "Colour difference after colour vision simulation")}
      </div>
      <div class="panel">
        <h3>The figures the specification prints</h3>
        ${table(["Pair", "Typical", "Protan", "Deutan", "Tritan"], refs, "Colour vision figures against the specification")}
        <p class="note">Pure red and amber fall under 20 for deuteranopia. That is why wrong is rose-magenta.</p>
      </div>
    </div>`,
  );
}

function parseHexTuple(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  return [r, g, b];
}

function focusSection(): string {
  return section(
    "focus",
    "Focus",
    "A 3 px ring in the text colour with a 2 px gap in the canvas colour. It appears at once and it is never amber, because amber means a light is on. Press Tab to move through these.",
    `<div class="grid">
      <div class="panel">
        <h3>The ring</h3>
        <div class="row">
          <span class="focus-sample">Ring and gap</span>
          <p class="note">Ring against its gap: <span class="figure">${ratioOn("--focus", "--focus-gap")}</span>. Ring against the surface: <span class="figure">${ratioOn("--focus", "--surface")}</span>.</p>
        </div>
      </div>
      <div class="panel">
        <h3>Try it</h3>
        <div class="row">
          <button type="button">Button</button>
          <a href="#focus">A link</a>
          <label>Field <input type="text" placeholder="Type here" /></label>
          <label><input type="checkbox" /> A checkbox</label>
          <label>Choice
            <select><option>Ode to Joy</option><option>Fur Elise</option></select>
          </label>
        </div>
      </div>
    </div>`,
  );
}

function shapeSection(): string {
  const space = SPACE_TOKENS.map((t) => {
    const rem = toRem(css(t));
    return `<div class="space-row"><span class="figure"><code>${t.replace("--space-", "")}</code> ${fmt(rem * remBase())} px</span><span class="space-bar" style="inline-size: var(${t})"></span></div>`;
  }).join("");

  return section(
    "shape",
    "Space and shape",
    "A 4 px grid, set in rem. Flat surfaces: no shadow carries meaning. Controls have a 2 px meaningful border and an 8 px radius.",
    `<div class="grid grid-2">
      <div class="panel"><h3>Space</h3>${space}</div>
      <div class="panel">
        <h3>Boundaries</h3>
        <div class="grid">
          <div class="shape-box shape-decorative">Panel: 1 px decorative border</div>
          <div class="shape-box shape-control">Control: 2 px meaningful border</div>
          <div class="shape-box shape-dialog">Dialog: 2 px border in the text colour</div>
        </div>
      </div>
      <div class="panel" id="targets">
        <h3>Targets</h3>
        <div class="row" id="target-boxes">
          <span class="target-box" data-token="--target-site" style="inline-size: var(--target-site); block-size: var(--target-site)">Site</span>
          <span class="target-box" data-token="--target-app" style="inline-size: var(--target-app); block-size: var(--target-app)">App</span>
          <span class="target-box" data-token="--practice-transport" style="inline-size: var(--practice-transport); block-size: var(--practice-transport)">Practice</span>
        </div>
        <p class="figure" id="target-figures"></p>
        <p class="note">At least 8 px between neighbouring targets.</p>
      </div>
    </div>`,
  );
}

function controlsSection(): string {
  return section(
    "controls",
    "Controls",
    "The states of the base controls. Hover and focus appear as you use them. Every boundary survives forced colours.",
    `<div class="panel">
      <div class="row">
        <button type="button" class="button-primary">${iconMarkup("play")}Play</button>
        <button type="button">${iconMarkup("settings")}Secondary</button>
        <button type="button" class="button-quiet">${iconMarkup("back")}Quiet</button>
        <button type="button" class="button-destructive">${iconMarkup("warning")}Delete everything</button>
        <button type="button" disabled>Disabled</button>
        <button type="button" aria-busy="true">Busy</button>
        <button type="button" aria-pressed="true">${iconMarkup("tick")}Selected</button>
        <a class="button" href="#controls">${iconMarkup("external")}External link<span class="visually-hidden"> (opens another site)</span></a>
      </div>
    </div>`,
  );
}

function iconsSection(): string {
  const cards = (Object.keys(ICONS) as IconName[])
    .map((name) => {
      const info = ICONS[name];
      return `<li class="icon-card">${iconMarkup(name)}<div><p><strong>${esc(info.label)}</strong></p><p class="note">${esc(info.meaning)}</p></div></li>`;
    })
    .join("");
  return section(
    "icons",
    "Icons",
    "Phosphor, bold weight, MIT licence. One set with one stroke weight. Each mark is the standard one for its job and carries a word wherever it is a control.",
    `<ul class="icon-grid">${cards}</ul>`,
  );
}

function motionSection(): string {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return section(
    "motion",
    "Motion",
    "Lights and keys change at once. Dialogs, toasts and hover use opacity or colour only. With reduced motion on, every duration is zero.",
    `<div class="panel">
      <p class="figure">Duration in: ${esc(css("--duration-in"))}. Duration out: ${esc(css("--duration-out"))}. Hover: ${esc(css("--duration-hover"))}.</p>
      <p id="motion-state" class="figure">Reduced motion is ${reduced ? "on, so the panel below changes at once" : "off, so the panel below fades"}.</p>
      <p><button type="button" id="fade-toggle" aria-controls="fade-panel" aria-expanded="true">Hide the panel</button></p>
      <div class="fade-panel" id="fade-panel" data-hidden="false">This panel changes only in opacity.</div>
    </div>`,
  );
}

function setsSection(): string {
  const all = evaluatePairs(model, pairs);
  const byPair = new Map<string, Map<SetName, (typeof all)[number]>>();
  for (const r of all) {
    const m = byPair.get(r.pair.id) ?? new Map();
    m.set(r.set, r);
    byPair.set(r.pair.id, m);
  }
  const failures = all.filter((r) => !r.passes).length;
  let compared = 0;
  let differs = 0;
  const rows = pairs.pairs.map((p) => {
    const m = byPair.get(p.id);
    const cells = SET_NAMES.map((s) => {
      const r = m?.get(s);
      if (!r) return "Not used";
      const spec = specFigure(p, s);
      let note = "";
      if (spec !== undefined) {
        compared++;
        if (round2(r.ratio) !== spec) {
          differs++;
          note = ` <span class="note">(spec ${spec.toFixed(2)})</span>`;
        }
      }
      return `<span class="figure">${r.ratio.toFixed(2)}${r.passes ? "" : " FAILS"}</span>${note}`;
    });
    return [`<code>${p.id}</code><br /><span class="note">${ROLE_LABEL[p.role]}${minimumFor(pairs, "light", p.role) === null ? "" : `, needs ${minimumFor(pairs, "light", p.role)} or ${minimumFor(pairs, "light-more", p.role)} in the contrast sets`}</span>`, ...cells];
  });
  return section(
    "sets",
    "All four sets",
    `The same pairings in all four sets. ${all.length} measurements, ${failures} below their minimum. ${compared} compared with the specification, ${differs} differ.`,
    table(["Pairing", ...SET_NAMES.map((s) => SET_LABEL[s])], rows, "Contrast ratio of every pairing in every set"),
  );
}

function buttons(host: string, choices: Choice[], key: "theme" | "contrast" | "distance"): void {
  const el = document.getElementById(host);
  if (!el) return;
  el.innerHTML = choices
    .map((c) => `<button type="button" data-value="${c.value}">${c.icon ? iconMarkup(c.icon) : ""}${c.label}</button>`)
    .join("");
  el.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      state[key] = b.dataset["value"] ?? "";
      apply();
    }),
  );
}

// the controls are built once, so keyboard focus stays on the button that was pressed
function syncControls(): void {
  for (const [host, key] of [["control-theme", "theme"], ["control-contrast", "contrast"], ["control-distance", "distance"]] as const) {
    document.querySelectorAll<HTMLButtonElement>(`#${host} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset["value"] === state[key])));
  }
}

function apply(): void {
  if (state.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.theme);
  if (state.contrast === "more") root.setAttribute("data-contrast", "more");
  else root.removeAttribute("data-contrast");
  root.setAttribute("data-distance", state.distance);
  syncControls();
  void render();
}

let renderId = 0;

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// the sections are added one frame at a time, so no single task blocks the page for long
async function render(): Promise<void> {
  const host = document.getElementById("sections");
  if (!host) return;
  const mine = ++renderId;
  cache.clear();

  const set = activeSet();
  const stateEl = document.getElementById("state");
  if (stateEl) stateEl.textContent = `Showing the ${SET_LABEL[set].toLowerCase()} set at the ${state.distance} distance.`;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = css("--canvas");

  const builders = [typeSection, colourSection, lightsSection, visionSection, focusSection, shapeSection, controlsSection, iconsSection, motionSection, setsSection];
  const parts: string[] = [];
  for (const build of builders) {
    parts.push(build());
    // the first section appears at once and the rest follow
    if (parts.length === 1) host.innerHTML = parts[0] ?? "";
    await nextFrame();
    if (mine !== renderId) return;
    if (parts.length > 1) host.insertAdjacentHTML("beforeend", parts[parts.length - 1] ?? "");
  }

  const figures = document.getElementById("target-figures");
  if (figures) {
    figures.textContent = [...document.querySelectorAll<HTMLElement>("#target-boxes .target-box")]
      .map((b) => {
        const r = b.getBoundingClientRect();
        return `${b.textContent ?? ""}: ${Math.round(r.width)} by ${Math.round(r.height)} px`;
      })
      .join(". ");
  }

  const toggle = document.getElementById("fade-toggle");
  const panel = document.getElementById("fade-panel");
  toggle?.addEventListener("click", () => {
    const hidden = panel?.getAttribute("data-hidden") === "true";
    panel?.setAttribute("data-hidden", hidden ? "false" : "true");
    toggle.setAttribute("aria-expanded", hidden ? "true" : "false");
    toggle.textContent = hidden ? "Hide the panel" : "Show the panel";
  });
}

function readQuery(): void {
  const q = new URLSearchParams(window.location.search);
  const pick = (key: "theme" | "contrast" | "distance", choices: Choice[]): void => {
    const v = q.get(key);
    if (v && choices.some((c) => c.value === v)) state[key] = v;
  };
  pick("theme", THEMES);
  pick("contrast", CONTRASTS);
  pick("distance", DISTANCES);
}

readQuery();
buttons("control-theme", THEMES, "theme");
buttons("control-contrast", CONTRASTS, "contrast");
buttons("control-distance", DISTANCES, "distance");
apply();
document.fonts.ready.then(() => {
  const el = document.getElementById("font-status");
  if (el) el.textContent = faceStatus().join(". ");
});
for (const query of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(prefers-reduced-motion: reduce)"]) {
  window.matchMedia(query).addEventListener("change", () => void render());
}
