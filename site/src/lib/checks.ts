// a claim on the site is tied to checks that read the repository's own files. a check is a property of the code
// (a file exists, a constant has a value, a call is made in one place only) and never only a phrase in a README.
// runCheck takes the root so a test can run it against a scratch tree and prove that it fails when the property is false.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type Check =
  // the path exists
  | { exists: string }
  // the path does not exist
  | { missing: string }
  // the file contains the text
  | { file: string; contains: string }
  // the file does not match the pattern
  | { file: string; absent: string }
  // the file matches the pattern
  | { file: string; matches: string }
  // no file under the folder matches the pattern, apart from the ones named
  | { under: string; absent: string; except?: string[] }
  // exactly these files under the folder match the pattern
  | { under: string; only: string[]; pattern: string }
  // no file under the folder has a name that matches the pattern
  | { under: string; noFileNamed: string }
  // a test that lives in the package that owns the behaviour: the file exists, a test with this title is in it, it is
  // not skipped and its body asserts something. a renamed or skipped test fails the check
  | { test: { file: string; title: string } };

// where a check reads from: "code" reads source or data, "document" reads prose that a person keeps. a claim that
// something is built needs at least one code check. a claim that a person has not yet checked something can only be
// a document, since nothing in code can show that nobody has looked
export const isCode = (check: Check): boolean => !("file" in check && check.file.endsWith(".md"));

const SKIPPED = /\.(skip|todo|fixme|only)\b|\bx(it|test|describe)\(/;

// removes comments and string-free noise from non-TypeScript test files so that a word in a comment is not an assertion
function stripComments(text: string, file: string): string {
  if (/\.py$/.test(file)) return text.replace(/#.*$/gm, "");
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// a real call to expect or an assert function inside the body, found in the syntax tree and not in the text, so a comment
// or a string that contains the word does not count
function tsProblem(text: string, file: string, title: string): string | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nameOf = (e: ts.Expression): string => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? `${nameOf(e.expression)}.${e.name.text}` : ts.isCallExpression(e) ? nameOf(e.expression) : "");
  const titleOf = (n: ts.CallExpression): string | null => {
    const a = n.arguments[0];
    return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
  };
  let found: ts.CallExpression | null = null;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && /^(it|test)(\.\w+)?$/.test(nameOf(n.expression)) && titleOf(n) === title) found ??= n;
    ts.forEachChild(n, visit);
  };
  visit(source);
  if (!found) return `no test is called "${title}"`;
  const call: ts.CallExpression = found;
  // the test itself and every block around it must not be skipped, focused or marked todo
  for (let n: ts.Node | undefined = call; n; n = n.parent) {
    if (ts.isCallExpression(n) && SKIPPED.test(nameOf(n.expression).replace(/^(.*?)(\.|$)/, ".$1$2") + "(") ) return `the test "${title}" is skipped, focused or marked todo`;
    if (ts.isCallExpression(n) && /\.(skip|only|todo|fixme)$/.test(nameOf(n.expression))) return `the test "${title}" is skipped, focused or marked todo`;
  }
  let asserts = false;
  const look = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = nameOf(n.expression);
      if (/^expect(\.|$)/.test(name) || /^(assert|expectTypeOf)(\.|$)/.test(name) || /^assert[A-Z]\w*$/.test(name)) asserts = true;
    }
    ts.forEachChild(n, look);
  };
  const callback = call.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  if (callback) look(callback);
  return asserts ? null : `the test "${title}" has no call to expect or assert`;
}

// the package's own test configuration must pick the file up. a test file that no configuration matches never runs
function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^$|()[\]\\]/g, "\\$&")
    .replace(/\{([^}]*)\}/g, (_, alts: string) => `(?:${alts.split(",").join("|")})`)
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${re}$`);
}

function listIn(config: string, key: string): string[] | null {
  const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(config);
  return m ? [...(m[1] ?? "").matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1] ?? "") : null;
}

export function configProblem(root: string, file: string): string | null {
  const parts = file.split("/");
  const pkg = parts[0] ?? "";
  if (!existsSync(join(root, pkg, "package.json"))) return null;
  const rel = parts.slice(1).join("/");
  const read = (name: string): string | null => (existsSync(join(root, pkg, name)) ? readFileSync(join(root, pkg, name), "utf8") : null);
  if (/\.e2e\.tsx?$/.test(file)) {
    const cfg = read("playwright.config.ts");
    if (cfg === null) return `${pkg} has no Playwright configuration, so ${file} never runs`;
    const dir = /testDir:\s*["']([^"']+)["']/.exec(cfg)?.[1] ?? ".";
    const matches = [...cfg.matchAll(/testMatch:\s*["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    if (matches.length === 0) matches.push("**/*.@(spec|test).?(c|m)[jt]s?(x)");
    const inDir = rel.startsWith(dir.replace(/^\.\//, "") + "/") || dir === ".";
    const relToDir = rel.slice(dir === "." ? 0 : dir.length + 1);
    if (!inDir) return `${file} is outside the Playwright test directory ${dir}`;
    return matches.some((m) => globToRegExp(m).test(relToDir)) ? null : `${file} is not matched by the Playwright testMatch ${matches.join(" or ")}`;
  }
  const cfg = read("vitest.config.ts") ?? read("vitest.config.mts") ?? read("vite.config.ts");
  if (cfg === null) return null;
  const include = listIn(cfg, "include") ?? ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
  const exclude = listIn(cfg, "exclude") ?? [];
  if (exclude.some((g) => globToRegExp(g).test(rel))) return `${file} is excluded by ${pkg}'s test configuration`;
  return include.some((g) => globToRegExp(g).test(rel)) ? null : `${file} is not matched by the include list of ${pkg}'s test configuration`;
}

const ASSERTS_TEXT = /assert|ASSERT/;

// the problem with a named test or null when it exists, is picked up by its package's configuration, is not skipped,
// is run and asserts something
export function testProblem(text: string, title: string, file = "x.ts", root?: string): string | null {
  if (/\.tsx?$/.test(file)) {
    const configured = root ? configProblem(root, file) : null;
    return configured ?? tsProblem(text, file, title);
  }
  const clean = stripComments(text, file);
  const at = [clean.indexOf(`void ${title}(`), clean.indexOf(`def ${title}(`), clean.indexOf(`fn ${title}(`)].filter((i) => i >= 0).sort((x, y) => x - y)[0];
  if (at === undefined) return `no test is called "${title}"`;
  if (clean.includes(`void ${title}(`) && !clean.includes(`RUN_TEST(${title})`)) return `the test "${title}" is written and never run`;
  const rest = clean.slice(at + title.length);
  const next = rest.search(/\nvoid test_|\n(async )?def |\n\s*(pub )?fn |\n\s*#\[test\]/);
  const body = next < 0 ? rest : rest.slice(0, next);
  return ASSERTS_TEXT.test(body) ? null : `the test "${title}" asserts nothing`;
}

export function filesUnder(root: string, dir: string): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((n) => {
    const rel = `${dir}/${n}`;
    if (n === "node_modules" || n === "dist" || n === "target" || n === ".git") return [];
    return statSync(join(root, rel)).isDirectory() ? filesUnder(root, rel) : [rel];
  });
}

const isTest = (p: string): boolean => /\.test\.tsx?$/.test(p) || /\.e2e\.ts$/.test(p) || /\/tests?\//.test(p);
const isSource = (p: string): boolean => /\.(ts|tsx|js|json|html|css|py|cpp|h|rs|yml|yaml|csv)$/.test(p) && !isTest(p);

// null when the property holds, otherwise a sentence that says what changed
export function runCheck(check: Check, root: string): string | null {
  if ("test" in check) {
    const path = join(root, check.test.file);
    if (!existsSync(path)) return `${check.test.file} does not exist`;
    const problem = testProblem(readFileSync(path, "utf8"), check.test.title, check.test.file, root);
    return problem ? `${check.test.file}: ${problem}` : null;
  }
  if ("exists" in check) return existsSync(join(root, check.exists)) ? null : `${check.exists} does not exist`;
  if ("missing" in check) return existsSync(join(root, check.missing)) ? `${check.missing} now exists` : null;
  if ("noFileNamed" in check) {
    const re = new RegExp(check.noFileNamed);
    const hits = filesUnder(root, check.under).filter((p) => re.test(p));
    return hits.length === 0 ? null : `${hits.join(", ")} now exists under ${check.under}`;
  }
  if ("file" in check) {
    const path = join(root, check.file);
    if (!existsSync(path)) return `${check.file} does not exist`;
    const text = readFileSync(path, "utf8");
    if ("contains" in check) return text.includes(check.contains) ? null : `${check.file} no longer contains "${check.contains}"`;
    if ("matches" in check) return new RegExp(check.matches).test(text) ? null : `${check.file} no longer matches ${check.matches}`;
    return new RegExp(check.absent).test(text) ? `${check.file} now matches ${check.absent}` : null;
  }
  const re = new RegExp("pattern" in check ? check.pattern : check.absent);
  const hits = filesUnder(root, check.under)
    .filter(isSource)
    .filter((p) => re.test(readFileSync(join(root, p), "utf8")));
  if ("only" in check) {
    const extra = hits.filter((h) => !check.only.includes(h));
    const lost = check.only.filter((o) => !hits.includes(o));
    return extra.length + lost.length === 0 ? null : `files matching ${check.pattern} changed: new ${extra.join(", ") || "none"}, gone ${lost.join(", ") || "none"}`;
  }
  const extra = hits.filter((h) => !(check.except ?? []).includes(h));
  return extra.length === 0 ? null : `${extra.join(", ")} now matches ${check.absent}`;
}

export const runChecks = (checks: Check[], root: string): string[] => checks.map((c) => runCheck(c, root)).filter((f): f is string => f !== null);

// the smallest scratch tree in which a check holds and the same tree with the property broken. used to prove that a
// check can fail. it returns the files to write for each state, as path to text (null deletes the path)
export function scratchFor(check: Check): { holds: Record<string, string | null>; broken: Record<string, string | null> } {
  if ("test" in check) {
    const { file, title } = check.test;
    const body = (name: string): string =>
      /\.py$/.test(file) ? `def ${name}():\n    assert 1 == 1\n` : /\.rs$/.test(file) ? `fn ${name}() {\n    assert_eq!(1, 1);\n}\n` : /\.(cpp|h)$/.test(file) ? `void ${name}() {\n    TEST_ASSERT_TRUE(true);\n}\nint main() {\n    RUN_TEST(${name});\n}\n` : `it("${name}", () => {\n  expect(1).toBe(1);\n});\n`;
    return { holds: { [file]: body(title) }, broken: { [file]: body("another_title") } };
  }
  if ("exists" in check) return { holds: { [check.exists]: "x" }, broken: { [check.exists]: null } };
  if ("missing" in check) return { holds: {}, broken: { [check.missing]: "x" } };
  if ("noFileNamed" in check) return { holds: { [`${check.under}/keep.txt`]: "x" }, broken: { [`${check.under}/${sampleName(check.noFileNamed)}`]: "x" } };
  if ("file" in check) {
    if ("contains" in check) return { holds: { [check.file]: `a ${check.contains} b` }, broken: { [check.file]: "a b" } };
    if ("matches" in check) return { holds: { [check.file]: sample(check.matches) }, broken: { [check.file]: "nothing" } };
    return { holds: { [check.file]: "nothing" }, broken: { [check.file]: sample(check.absent) } };
  }
  if ("only" in check) {
    const holds = Object.fromEntries(check.only.map((f) => [f, sample(check.pattern)]));
    return { holds, broken: { ...holds, [`${check.under}/new-file.ts`]: sample(check.pattern) } };
  }
  const except = Object.fromEntries((check.except ?? []).map((f) => [f, sample(check.absent)]));
  return { holds: { [`${check.under}/a.ts`]: "nothing", ...except }, broken: { [`${check.under}/a.ts`]: sample(check.absent), ...except } };
}

// a string a pattern matches, for the patterns this site uses: the alternatives are tried in turn and the escapes
// are dropped. a pattern that this cannot satisfy fails the test that uses it, so it is never wrong in silence
export function sample(pattern: string): string {
  const first = pattern.split("|")[0] ?? pattern;
  return first.replace(/\\\(/g, "\u0001").replace(/\\\)/g, "\u0002").replace(/\\b/g, "").replace(/\\d\+?/g, "1").replace(/([a-z])\?/g, "$1").replace(/\\\*/g, "*").replace(/\\\./g, ".").replace(/\\\//g, "/").replace(/\\s[+*]?/g, " ").replace(/[()^$]/g, "").replace(/\.\*/g, "x").replace(/\[\^?([^\]]*)\]\+?/g, (_, set: string) => set[0] ?? "x").replaceAll("\u0001", "(").replaceAll("\u0002", ")");
}

function sampleName(pattern: string): string {
  return sample(pattern).replace(/^\^|\$$/g, "").replace(/\\\./g, ".") || "x";
}
