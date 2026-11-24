import { defineConfig, devices } from "@playwright/test";

// takes the specimen screenshots. run with: npm run specimen:shots
// set SHOTS_DIR to choose where the files go. the default is test-results/shots
const PORT = 5181;

export default defineConfig({
  testDir: "tests/shots",
  testMatch: "**/*.shots.ts",
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run specimen:build && npm run specimen:preview -- --host 127.0.0.1",
    url: `http://127.0.0.1:${PORT}/specimen.html`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
