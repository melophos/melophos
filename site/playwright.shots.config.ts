import { defineConfig, devices } from "@playwright/test";

// screenshots of every page at three widths in both themes. run with: npm run shots
// set SHOTS_DIR to choose where the files go. the default is test-results/shots
const PORT = 23190;

export default defineConfig({
  testDir: "tests/shots",
  testMatch: "**/*.shots.ts",
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node scripts/serve-dist.ts ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },
});
