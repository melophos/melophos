import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { APP_POLICY, headersFile } from "./scripts/csp.ts";
import { engineVersion } from "./scripts/engine-version.ts";
import { defineConfig, type Plugin } from "vite";

// the About page shows the exact version, because the AGPL source link depends on it. the commit comes from git when
// the build runs in a checkout and is "unknown" in a copy with no history
function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

const policy: Plugin = {
  name: "melophos-csp",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: APP_POLICY }, injectTo: "head-prepend" }],
};

// the service worker is the template with the list of built files and a version made from their contents. a changed
// file changes the version, which is what makes the browser see a new worker and the page offer the update
const worker: Plugin = {
  name: "melophos-service-worker",
  apply: "build",
  closeBundle() {
    const out = new URL("./dist/", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (!name.endsWith(".map") && name !== "sw.js") files.push(`/${relative(out, full)}`);
      }
    };
    walk(out);
    files.sort();
    const hash = createHash("sha256");
    for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
    const list = ["/", ...files];
    const source = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8").replace("__VERSION__", hash.digest("hex").slice(0, 12)).replace("__PRECACHE__", JSON.stringify(list));
    writeFileSync(join(out, "sw.js"), source);
    // the same policy as a real header, which also covers the worker and sets frame-ancestors
    writeFileSync(join(out, "_headers"), headersFile());
  },
};

export default defineConfig({
  plugins: [policy, worker],
  define: {
    __STUDIO_VERSION__: JSON.stringify(version),
    __STUDIO_COMMIT__: JSON.stringify(commit()),
    __ENGINE_VERSION__: JSON.stringify(engineVersion(new URL(".", import.meta.url).pathname)),
  },
  build: { target: "es2022" },
});
