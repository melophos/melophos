// a small reader for the CSS this project writes: rules, at-rule context and declarations.
// it is not a full parser. it handles comments, strings, nested at-rules and parentheses, which is all the checks need.

export interface Declaration {
  prop: string;
  value: string;
}

export interface CssRule {
  selector: string;
  // enclosing at-rules, outermost first, for example "@media (prefers-contrast: more)"
  context: string[];
  declarations: Declaration[];
  // value of the nearest "@set name" comment above the rule or an enclosing at-rule
  set: string | null;
  // 1-based line of the selector
  line: number;
}

const CONTAINER_AT_RULES = /^@(media|supports|layer|container|keyframes|-webkit-keyframes)\b/;

export function scanCss(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: { label: string; set: string | null }[] = [];
  let prelude = "";
  let preludeLine = 1;
  let line = 1;
  let i = 0;
  const n = source.length;

  const readDeclarations = (start: number): { decls: Declaration[]; end: number; lines: number } => {
    let depth = 0;
    let quote = "";
    let buf = "";
    const decls: Declaration[] = [];
    let j = start;
    let lines = 0;
    const flush = () => {
      const text = buf.trim();
      buf = "";
      const colon = text.indexOf(":");
      if (colon > 0) {
        decls.push({ prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim() });
      }
    };
    for (; j < n; j++) {
      const c = source.charAt(j);
      if (c === "\n") {
        lines++;
      }
      if (quote) {
        buf += c;
        if (c === quote && source.charAt(j - 1) !== "\\") {
          quote = "";
        }
        continue;
      }
      if (c === "/" && source.charAt(j + 1) === "*") {
        const end = source.indexOf("*/", j + 2);
        const stop = end === -1 ? n : end + 2;
        lines += (source.slice(j, stop).match(/\n/g) ?? []).length;
        j = stop - 1;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        buf += c;
        continue;
      }
      if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
      }
      if (c === ";" && depth === 0) {
        flush();
        continue;
      }
      if (c === "}" && depth === 0) {
        flush();
        return { decls, end: j, lines };
      }
      buf += c;
    }
    flush();
    return { decls, end: j, lines };
  };

  let pendingSet: string | null = null;
  while (i < n) {
    const c = source.charAt(i);
    if (c === "\n") {
      line++;
    }
    if (c === "/" && source.charAt(i + 1) === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      const comment = source.slice(i, stop);
      const m = /@set\s+([a-z-]+)/.exec(comment);
      if (m?.[1]) {
        pendingSet = m[1];
      }
      line += (comment.match(/\n/g) ?? []).length;
      i = stop;
      continue;
    }
    if (c === "{") {
      const selector = prelude.trim().replace(/\s+/g, " ");
      const inheritedSet = [...stack].reverse().find((s) => s.set)?.set ?? null;
      const set = pendingSet ?? inheritedSet;
      pendingSet = null;
      if (CONTAINER_AT_RULES.test(selector)) {
        stack.push({ label: selector, set });
        prelude = "";
        i++;
        continue;
      }
      const { decls, end, lines } = readDeclarations(i + 1);
      rules.push({
        selector,
        context: stack.map((s) => s.label),
        declarations: decls,
        set,
        line: preludeLine,
      });
      line += lines;
      prelude = "";
      i = end + 1;
      continue;
    }
    if (c === "}") {
      stack.pop();
      prelude = "";
      i++;
      continue;
    }
    if (c === ";" && prelude.trim().startsWith("@")) {
      // a statement at-rule such as @import
      prelude = "";
      i++;
      continue;
    }
    if (prelude.trim() === "") {
      preludeLine = line;
    }
    prelude += c;
    i++;
  }
  return rules;
}
