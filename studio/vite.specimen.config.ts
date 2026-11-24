import { defineConfig, type Plugin } from "vite";
import { SPECIMEN_POLICY } from "./scripts/csp.ts";

// the specimen page has a policy of its own, stricter than the app's
const policy: Plugin = {
  name: "melophos-specimen-csp",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: SPECIMEN_POLICY }, injectTo: "head-prepend" }],
};

// the specimen is a separate build, so it never ships in the Studio's dist
export default defineConfig({
  plugins: [policy],
  build: {
    outDir: "dist-specimen",
    emptyOutDir: true,
    rollupOptions: { input: "specimen.html" },
  },
});
