import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Ensemble E2E tests (L5).
 *
 * Two modes:
 *
 *   - Local (default): we boot both the API server and Vite dev server
 *     ourselves. Server runs in fixture mode — ENSEMBLE_TEST_MODE=fixture
 *     swaps the real `managed-agents` runtime for a RecordedRuntime that
 *     plays scripted chunks from `e2e/fixtures/default.json`. No real
 *     Anthropic call, no API key, no flakiness.
 *
 *   - Live deployed (set PLAYWRIGHT_BASE_URL): we skip the webServer
 *     block and point at the URL the env var supplies (e.g. the Fly
 *     deploy). Only specs tagged `@prod` should be selected.
 *
 * Run:
 *   bun x playwright test                            # local fixture mode
 *   PLAYWRIGHT_BASE_URL=https://… bun x playwright test --grep @prod
 *
 * Specs tagged `@live` (real Anthropic) are excluded by default; opt
 * in with `--grep @live` and a real `ANTHROPIC_API_KEY`.
 */

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const usingExternal = !!process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  // Skip @live by default. `--grep @live` opts in.
  grepInvert: /@live/,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: usingExternal
    ? undefined
    : [
        {
          command:
            "JWT_SECRET=a-test-secret-at-least-16-chars-long " +
            "ANTHROPIC_API_KEY=sk-ant-placeholder-no-network-needed " +
            "MEMORY_BACKEND=in-memory " +
            "MANAGED_AGENTS_MODE=direct " +
            "ENSEMBLE_TEST_MODE=fixture " +
            "ENSEMBLE_E2E_FIXTURES=./e2e/fixtures/default.json " +
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
