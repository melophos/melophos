// colour vision separation: simulates protanopia, deuteranopia and tritanopia on the light roles.
// run on its own with: npm run check:vision
import { describe, expect, it } from "vitest";
import { VISIONS, contrast, deltaE, parseHex, type Rgb, type Vision } from "../src/styles/colour.ts";
import { parseTokens, tokenValue } from "../src/styles/tokens-model.ts";
import { read } from "./lib/files.ts";

interface Role {
  id: string;
  token: string | null;
  led: [number, number, number] | null;
}

interface Reference {
  name: string;
  a: string;
  b: string;
  spec: Partial<Record<Vision, number>>;
  luminance?: number;
  expect?: string;
}

interface Lights {
  roles: Role[];
  separation: { minimum: number; screen: string[]; led: string[] };
  reference: Reference[];
}

const lights = JSON.parse(read("src/styles/lights.json")) as Lights;
const model = parseTokens(read("src/styles/tokens.css"));
const MINIMUM = lights.separation.minimum;

const screenColour = (id: string): Rgb => {
  const role = lights.roles.find((r) => r.id === id);
  const value = role?.token ? tokenValue(model, "light", role.token) : undefined;
  if (!value) throw new Error(`role ${id} has no screen colour`);
  return parseHex(value);
};

const ledColour = (id: string): Rgb => {
  const led = lights.roles.find((r) => r.id === id)?.led;
  if (!led) throw new Error(`role ${id} has no LED value`);
  return led;
};

function pairsOf(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => out.push([a, b])));
  return out;
}

describe("colour vision separation", () => {
  it("keeps every pair of screen light roles 20 or more apart in every simulation", () => {
    const failures: string[] = [];
    for (const [a, b] of pairsOf(lights.separation.screen)) {
      for (const vision of VISIONS) {
        const d = deltaE(screenColour(a), screenColour(b), vision);
        if (d < MINIMUM) failures.push(`screen ${a} and ${b} under ${vision}: ${d.toFixed(1)} is under ${MINIMUM}`);
      }
    }
    expect(failures, `\n${failures.join("\n")}`).toEqual([]);
  });

  it("keeps every pair of LED roles 20 or more apart in every simulation", () => {
    const failures: string[] = [];
    for (const [a, b] of pairsOf(lights.separation.led)) {
      for (const vision of VISIONS) {
        const d = deltaE(ledColour(a), ledColour(b), vision);
        if (d < MINIMUM) failures.push(`LED ${a} and ${b} under ${vision}: ${d.toFixed(1)} is under ${MINIMUM}`);
      }
    }
    expect(failures, `\n${failures.join("\n")}`).toEqual([]);
  });

  it("reproduces the figures the specification prints", () => {
    const differences: string[] = [];
    for (const ref of lights.reference) {
      for (const vision of VISIONS) {
        const spec = ref.spec[vision];
        if (spec === undefined) continue;
        const measured = deltaE(parseHex(ref.a), parseHex(ref.b), vision);
        if (measured.toFixed(1) !== spec.toFixed(1)) {
          differences.push(`${ref.name} under ${vision}: measures ${measured.toFixed(1)} and the spec says ${spec.toFixed(1)}`);
        }
      }
      if (ref.luminance !== undefined) {
        const lum = contrast(parseHex(ref.a), parseHex(ref.b));
        if (lum.toFixed(2) !== ref.luminance.toFixed(2)) {
          differences.push(`${ref.name} luminance ratio measures ${lum.toFixed(2)} and the spec says ${ref.luminance.toFixed(2)}`);
        }
      }
    }
    expect(differences, `\n${differences.join("\n")}`).toEqual([]);
  });

  it("still shows why pure red was rejected: red and amber fall under 20 for deuteranopia", () => {
    const red = lights.reference.find((r) => r.expect === "fails under deuteranopia");
    expect(red).toBeDefined();
    expect(deltaE(parseHex(red?.a ?? "#000000"), parseHex(red?.b ?? "#000000"), "deutan")).toBeLessThan(MINIMUM);
  });

  it("keeps rose-magenta 35.6 or more from amber and 40.3 or more from blue, as the specification says", () => {
    const sims = VISIONS.filter((v) => v !== "normal");
    const amber = Math.min(...sims.map((v) => deltaE(ledColour("next-right"), ledColour("wrong"), v)));
    const blue = Math.min(...sims.map((v) => deltaE(ledColour("next-left"), ledColour("wrong"), v)));
    expect(amber).toBeGreaterThanOrEqual(35.55);
    expect(blue).toBeGreaterThanOrEqual(40.25);
  });
});
