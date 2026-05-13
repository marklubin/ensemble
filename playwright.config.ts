import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Ensemble v1 E2E tests (L5).
 *
 * Boots the web dev server in mock-only mode — no real backend is
 * required, the api-client falls back to its hardcoded fixtures when
 * the proxied API routes 404 / refuse connection.
 *
 * Run with: `bun x playwright test` (after `bun x playwright install chromium`).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun --filter @ensemble/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
