import { defineConfig } from "vitest/config";
import { engineVersion } from "./scripts/engine-version.ts";

// the browser tests run under Playwright, so Vitest only reads the unit and check files
export default defineConfig({
  define: { __ENGINE_VERSION__: JSON.stringify(engineVersion(new URL(".", import.meta.url).pathname)) },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
