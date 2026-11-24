// a check that cannot fail proves nothing. for every check of every claim on the site this builds the smallest tree in
// which the check holds, shows that it passes, breaks the property and shows that it fails.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PARTS } from "../src/data/status.ts";
import { HUB_CLAIMS } from "../src/data/hub-state.ts";
import { STUDIO_CLAIMS } from "../src/data/studio-state.ts";
import { DOC_CLAIMS } from "../src/data/docs-claims.ts";
import { runCheck, scratchFor, type Check } from "../src/lib/checks.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), "melophos-check-"));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function prove(check: Check): void {
  const { holds, broken } = scratchFor(check);
  expect(runCheck(check, tree(holds)), `holds in the scratch tree: ${JSON.stringify(check)}`).toBeNull();
  // the broken tree starts from the true one, then applies the change
  const files: Record<string, string | null> = { ...holds };
  for (const [path, text] of Object.entries(broken)) files[path] = text;
  expect(runCheck(check, tree(files)), `fails when the property is broken: ${JSON.stringify(check)}`).not.toBeNull();
}

const all: { owner: string; check: Check }[] = [
  ...PARTS.flatMap((p) => p.checks.map((check) => ({ owner: `part ${p.id}`, check }))),
  ...Object.values(HUB_CLAIMS).flatMap((c) => c.checks.map((check) => ({ owner: `hub ${c.id}`, check }))),
  ...STUDIO_CLAIMS.flatMap((c) => c.checks.map((check) => ({ owner: `studio ${c.id}`, check }))),
  ...DOC_CLAIMS.flatMap((c) => c.checks.map((check) => ({ owner: `doc ${c.statement.slice(0, 40)}`, check }))),
];

describe("every check fails when its property is false", () => {
  it("covers a lot of checks", () => {
    expect(all.length).toBeGreaterThan(100);
  });
  for (const { owner, check } of all) {
    it(`${owner}: ${JSON.stringify(check).slice(0, 110)}`, () => prove(check));
  }
});

describe("the check kinds, one by one", () => {
  it("a file that is removed", () => expect(runCheck({ exists: "a/b.ts" }, tree({}))).toMatch(/does not exist/));
  it("a path that appears", () => expect(runCheck({ missing: "a/b.ts" }, tree({ "a/b.ts": "x" }))).toMatch(/now exists/));
  it("text that leaves a file", () => expect(runCheck({ file: "f.ts", contains: "kLimit = 2700" }, tree({ "f.ts": "kLimit = 3000" }))).toMatch(/no longer contains/));
  it("a pattern that now matches", () => expect(runCheck({ file: "f.ts", absent: "redis" }, tree({ "f.ts": "import redis" }))).toMatch(/now matches/));
  it("a call that spreads to a new file", () => {
    const root = tree({ "src/a.ts": "fetch(1)", "src/b.ts": "fetch(2)" });
    expect(runCheck({ under: "src", pattern: "fetch", only: ["src/a.ts"] }, root)).toMatch(/new src\/b.ts/);
  });
  it("a file named like a board layout", () => expect(runCheck({ under: "hw", noFileNamed: "\\.kicad_pcb$" }, tree({ "hw/hub.kicad_pcb": "x" }))).toMatch(/now exists/));
  it("a test file is not source", () => expect(runCheck({ under: "src", absent: "fetch" }, tree({ "src/a.test.ts": "fetch" }))).toBeNull());
});

describe("a named test in another package", () => {
  const good = 'describe("x", () => {\n  it("keeps the token in memory", () => {\n    expect(1).toBe(1);\n  });\n  it("other", () => {\n    expect(2).toBe(2);\n  });\n});\n';
  const check: Check = { test: { file: "t.test.ts", title: "keeps the token in memory" } };
  it("passes when the test exists and asserts", () => expect(runCheck(check, tree({ "t.test.ts": good }))).toBeNull());
  it("fails when the test is renamed", () => expect(runCheck(check, tree({ "t.test.ts": good.replace("keeps the token", "holds the token") }))).toMatch(/no test is called/));
  it("fails when the test is skipped", () => expect(runCheck(check, tree({ "t.test.ts": good.replace("it(", "it.skip(") }))).toMatch(/skipped/));
  it("fails when the test asserts nothing", () => expect(runCheck(check, tree({ "t.test.ts": good.replace("expect(1).toBe(1);", "const a = 1;") }))).toMatch(/no call to expect or assert/));
  it("fails when a C++ test is written and never run", () => {
    const cpp = "void test_a() {\n    TEST_ASSERT_TRUE(true);\n}\nint main() {\n}\n";
    expect(runCheck({ test: { file: "m.cpp", title: "test_a" } }, tree({ "m.cpp": cpp }))).toMatch(/never run/);
    expect(runCheck({ test: { file: "m.cpp", title: "test_a" } }, tree({ "m.cpp": cpp.replace("int main() {", "int main() {\n    RUN_TEST(test_a);") }))).toBeNull();
  });
  it("finds a Python and a Rust test", () => {
    expect(runCheck({ test: { file: "a.py", title: "test_x" } }, tree({ "a.py": "def test_x(c):\n    assert c\n" }))).toBeNull();
    expect(runCheck({ test: { file: "a.rs", title: "x_holds" } }, tree({ "a.rs": "fn x_holds() {\n    assert_eq!(1, 1);\n}\n" }))).toBeNull();
  });
  it("fails when the word expect is only in a comment or a string", () => {
    expect(runCheck(check, tree({ "t.test.ts": good.replace("expect(1).toBe(1);", "// expect(1).toBe(1)") }))).toMatch(/no call/);
    expect(runCheck(check, tree({ "t.test.ts": good.replace("expect(1).toBe(1);", 'const s = "expect(1)";') }))).toMatch(/no call/);
    expect(runCheck(check, tree({ "t.test.ts": good.replace("expect(1).toBe(1);", "/* expect(1) */") }))).toMatch(/no call/);
  });
  it("fails when the test is inside a skipped or focused block or is only or todo", () => {
    expect(runCheck(check, tree({ "t.test.ts": good.replace("describe(", "describe.skip(") }))).toMatch(/skipped/);
    expect(runCheck(check, tree({ "t.test.ts": good.replace("it(\"keeps", "it.only(\"keeps") }))).toMatch(/skipped/);
    expect(runCheck(check, tree({ "t.test.ts": good.replace("it(\"keeps", "it.todo(\"keeps") }))).toMatch(/skipped/);
  });
  it("accepts an assert function and a Playwright expect", () => {
    expect(runCheck(check, tree({ "t.test.ts": good.replace("expect(1).toBe(1);", "assert.equal(1, 1);") }))).toBeNull();
    expect(runCheck(check, tree({ "t.test.ts": good.replace("expect(1).toBe(1);", "await expect(page).toHaveURL(/x/);") }))).toBeNull();
  });
  it("fails when the package's test configuration does not pick the file up", () => {
    const pkg = (cfg: string, file: string): string => tree({ "pk/package.json": "{}", "pk/vitest.config.ts": cfg, [`pk/${file}`]: good });
    const c: Check = { test: { file: "pk/src/a.test.ts", title: "keeps the token in memory" } };
    expect(runCheck(c, pkg('export default { test: { include: ["src/**/*.test.ts"] } };', "src/a.test.ts"))).toBeNull();
    expect(runCheck(c, pkg('export default { test: { include: ["tests/**/*.test.ts"] } };', "src/a.test.ts"))).toMatch(/not matched by the include/);
    expect(runCheck(c, pkg('export default { test: { include: ["src/**/*.test.ts"], exclude: ["src/a.test.ts"] } };', "src/a.test.ts"))).toMatch(/excluded/);
    const e: Check = { test: { file: "pk/tests/e2e/a.e2e.ts", title: "keeps the token in memory" } };
    const pw = (cfg: string): string => tree({ "pk/package.json": "{}", "pk/playwright.config.ts": cfg, "pk/tests/e2e/a.e2e.ts": good });
    expect(runCheck(e, pw('export default { testDir: "tests/e2e", testMatch: "**/*.e2e.ts" };'))).toBeNull();
    expect(runCheck(e, pw('export default { testDir: "tests/e2e", testMatch: "**/*.spec.ts" };'))).toMatch(/not matched by the Playwright/);
    expect(runCheck(e, pw('export default { testDir: "other", testMatch: "**/*.e2e.ts" };'))).toMatch(/outside the Playwright/);
  });
});
