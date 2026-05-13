import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Ensemble v1 E2E tests (L5).
 *
 * Boots both the API server (:4111) and the Vite dev server (:5173).
 * Server runs with an in-memory backend and a placeholder Anthropic
 * key so it boots without external dependencies; tests that exercise
 * real LLM calls live separately as L6 (`@live` tag).
 *
 * Run with: `bun x playwright test` (after `bun x playwright install chromium`).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "JWT_SECRET=a-test-secret-at-least-16-chars-long " +
        "ANTHROPIC_API_KEY=sk-ant-placeholder-no-network-needed " +
        "MEMORY_BACKEND=in-memory " +
        "MANAGED_AGENTS_MODE=direct " +
        "PORT=4111 " +
        "bun --filter @ensemble/server start",
      url: "http://localhost:4111/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "bun --filter @ensemble/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
