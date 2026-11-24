import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@phosphor-icons/core": fileURLToPath(new URL("./node_modules/@phosphor-icons/core", import.meta.url)) } },
  server: { fs: { allow: [".."] } },
});
