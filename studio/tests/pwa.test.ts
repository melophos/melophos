// the pieces of installing and working offline: the manifest, the theme colours and the service worker template
import { describe, expect, it } from "vitest";
import { parseTokens, tokenValue } from "../src/styles/tokens-model.ts";
import { read } from "./lib/files.ts";

const model = parseTokens(read("src/styles/tokens.css"));
const html = read("index.html");
const manifest = JSON.parse(read("public/manifest.webmanifest")) as Record<string, unknown> & { icons: { src: string }[] };
const worker = read("sw.template.js");
const config = read("vite.config.ts") + read("scripts/csp.ts");

describe("installing", () => {
  it("uses the canvas colours for the theme and the manifest", () => {
    const meta = [...html.matchAll(/name="theme-color" content="(#[0-9A-Fa-f]{6})" media="\(prefers-color-scheme: (\w+)\)"/g)];
    const byScheme = Object.fromEntries(meta.map((m) => [m[2], m[1]?.toLowerCase()]));
    expect(byScheme["light"]).toBe(tokenValue(model, "light", "--canvas")?.toLowerCase());
    expect(byScheme["dark"]).toBe(tokenValue(model, "dark", "--canvas")?.toLowerCase());
    expect(String(manifest["background_color"]).toLowerCase()).toBe(byScheme["dark"]);
    expect(String(manifest["theme_color"]).toLowerCase()).toBe(byScheme["dark"]);
  });

  it("is a standalone app that starts on the app page in landscape with every icon present", () => {
    expect(manifest["display"]).toBe("standalone");
    expect(manifest["orientation"]).toBe("landscape");
    expect(manifest["lang"]).toBe("en-GB");
    for (const icon of manifest.icons) expect(() => read(`public/${icon.src}`)).not.toThrow();
  });
});

// what the worker does is tested in a browser, in tests/e2e/app-hardening.e2e.ts ("the service worker never touches a request
// to another origin and never caches a signed-in answer"). a match on its source text proved nothing: the guard could be
// switched off and its words left in a comment. only what a text can really show is checked here
describe("the service worker file", () => {
  it("is built from a version of the files and the policy lets it run", () => {
    expect(worker).toContain("__VERSION__");
    expect(worker).toContain("__PRECACHE__");
    expect(config).toContain("worker-src 'self'");
    expect(config).toContain("manifest-src 'self'");
    expect(config).toContain("'wasm-unsafe-eval'");
  });
});
