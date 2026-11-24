// reads tokens.css and tokens.pairs.json into plain data, so the tests and the specimen page
// measure the same files the browser loads and never a copy.

import { contrastHex } from "./colour.ts";
import { scanCss } from "./css-scan.ts";

export const SET_NAMES = ["light", "dark", "light-more", "dark-more"] as const;
export type SetName = (typeof SET_NAMES)[number];
export type Role = "body" | "muted" | "mark" | "decorative";

export interface Pair {
  id: string;
  fg: string;
  bg: string;
  role: Role;
  use: string;
  spec?: { dark?: number; light?: number };
  sets?: SetName[];
}

export interface PairsFile {
  sets: SetName[];
  thresholds: Record<"standard" | "more", Record<"body" | "muted" | "mark", number>>;
  roles: Record<Role, string>;
  pairs: Pair[];
}

export interface TokenModel {
  // tokens outside any set, such as the type scale and the rail lights
  global: Record<string, string>;
  // tokens of each set, merged from every block that selects it
  sets: Record<SetName, Record<string, string>>;
  // how many blocks select each set
  blocks: Record<SetName, number>;
  // anything wrong with the file itself: unknown sets and blocks of one set that disagree
  problems: string[];
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isSetName(name: string): name is SetName {
  return (SET_NAMES as readonly string[]).includes(name);
}

export function parseTokens(css: string): TokenModel {
  const model: TokenModel = {
    global: {},
    sets: { light: {}, dark: {}, "light-more": {}, "dark-more": {} },
    blocks: { light: 0, dark: 0, "light-more": 0, "dark-more": 0 },
    problems: [],
  };
  const seen: { set: SetName; line: number; names: Set<string> }[] = [];
  for (const rule of scanCss(css)) {
    const custom = rule.declarations.filter((d) => d.prop.startsWith("--") || d.prop === "color-scheme");
    if (rule.set === null) {
      if (rule.selector === ":root" && rule.context.length === 0) {
        for (const d of custom) {
          model.global[d.prop] = d.value;
        }
      }
      continue;
    }
    if (!isSetName(rule.set)) {
      model.problems.push(`line ${rule.line}: unknown set "${rule.set}"`);
      continue;
    }
    const target = model.sets[rule.set];
    model.blocks[rule.set]++;
    for (const d of custom) {
      const previous = target[d.prop];
      if (previous !== undefined && previous.toLowerCase() !== d.value.toLowerCase()) {
        model.problems.push(
          `set "${rule.set}": ${d.prop} is ${previous} in one block and ${d.value} in the block at line ${rule.line}`,
        );
      }
      target[d.prop] = d.value;
    }
    seen.push({ set: rule.set, line: rule.line, names: new Set(custom.map((d) => d.prop)) });
  }
  // every block of a set must define every token the set defines
  for (const block of seen) {
    for (const known of Object.keys(model.sets[block.set])) {
      if (!block.names.has(known)) {
        model.problems.push(`set "${block.set}": the block at line ${block.line} does not define ${known}`);
      }
    }
  }
  return model;
}

// the value of a token in one set: the set's own value first, then the global one
export function tokenValue(model: TokenModel, set: SetName, token: string): string | undefined {
  return model.sets[set][token] ?? model.global[token];
}

export interface PairResult {
  pair: Pair;
  set: SetName;
  fg: string;
  bg: string;
  ratio: number;
  minimum: number | null;
  passes: boolean;
}

export function minimumFor(file: PairsFile, set: SetName, role: Role): number | null {
  if (role === "decorative") {
    return null;
  }
  return file.thresholds[set.endsWith("-more") ? "more" : "standard"][role];
}

export function evaluatePairs(model: TokenModel, file: PairsFile): PairResult[] {
  const out: PairResult[] = [];
  for (const set of file.sets) {
    for (const pair of file.pairs) {
      if (pair.sets && !pair.sets.includes(set)) {
        continue;
      }
      const fg = tokenValue(model, set, pair.fg);
      const bg = tokenValue(model, set, pair.bg);
      if (fg === undefined || bg === undefined || !HEX.test(fg) || !HEX.test(bg)) {
        throw new Error(`pair ${pair.id} in set ${set}: ${pair.fg} or ${pair.bg} is missing or not a hex colour`);
      }
      const ratio = contrastHex(fg, bg);
      const minimum = minimumFor(file, set, pair.role);
      out.push({ pair, set, fg, bg, ratio, minimum, passes: minimum === null || ratio >= minimum });
    }
  }
  return out;
}

// the set a spec figure belongs to: the specification prints dark and light only
export function specFigure(pair: Pair, set: SetName): number | undefined {
  if (set === "dark") {
    return pair.spec?.dark;
  }
  if (set === "light") {
    return pair.spec?.light;
  }
  return undefined;
}
