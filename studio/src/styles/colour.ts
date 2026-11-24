// colour maths shared by the contrast test, the colour vision test and the specimen page.
// the formulas match the audit scripts so a figure here can be compared with a figure there.

export type Rgb = readonly [number, number, number];
export type Vision = "normal" | "protan" | "deutan" | "tritan";

export const VISIONS: readonly Vision[] = ["normal", "protan", "deutan", "tritan"];

// a build may shorten #ffffff to #fff, so a computed value is always widened before it is compared
export function normaliseHex(value: string): string {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : v;
}

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(normaliseHex(hex));
  if (!m?.[1]) {
    throw new Error(`not a six digit hex colour: ${hex}`);
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// the WCAG 2 contrast ratio, between 1 and 21
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastHex(a: string, b: string): number {
  return contrast(parseHex(a), parseHex(b));
}

// the Machado, Oliveira and Fernandes 2009, severity 1.0, applied to linear light
const MACHADO: Record<Exclude<Vision, "normal">, readonly (readonly [number, number, number])[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulate(rgb: Rgb, vision: Vision): [number, number, number] {
  const v: [number, number, number] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  if (vision === "normal") {
    return v;
  }
  const m = MACHADO[vision];
  const out = m.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

function lab(v: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = v;
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / 0.95047);
  const fy = f(y);
  const fz = f(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// the CIE76 colour difference after the colour vision simulation. 20 or more is treated as clearly different
export function deltaE(a: Rgb, b: Rgb, vision: Vision): number {
  const la = lab(simulate(a, vision));
  const lb = lab(simulate(b, vision));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
