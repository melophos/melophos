import { defineConfig, devices } from "@playwright/test";

// the browser checks run on Chromium, the browser downloaded for this version. the specimen page and the built app
// are served by two preview servers on their own ports. firefox and webkit are added when the lane is covered there.
const SPECIMEN = 5181;
const APP = 5182;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"]],
  projects: [
    { name: "specimen", testMatch: "**/specimen.e2e.ts", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${SPECIMEN}` } },
    { name: "app", testMatch: "**/app*.e2e.ts", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${APP}` } },
  ],
  webServer: [
    {
      command: "npm run specimen:build && npm run specimen:preview -- --host 127.0.0.1",
      url: `http://127.0.0.1:${SPECIMEN}/specimen.html`,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
    {
      command: `npm run build && vite preview --port ${APP} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${APP}/`,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
  ],
});
