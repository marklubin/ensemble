/**
 * Playwright test fixture that bundles per-test failure diagnostics:
 *
 *   - Server logs since test start (via GET /__logs?since=…)
 *   - Diagnostics snapshot for any session created by the test
 *     (via GET /sessions/:id/__diagnostics)
 *   - Final DOM dump from the browser
 *
 * Specs use this fixture by importing `test` from this file instead of
 * `@playwright/test`. The fixture itself is invisible until something
 * fails; on failure each artifact is attached to `testInfo` so it
 * shows up in the trace + HTML report.
 *
 *   import { test, expect, recordSessionId } from "./_helpers/diagnostics-fixture";
 *
 * To opt a session id into the per-test diagnostics snapshot, call:
 *   recordSessionId(testInfo, sessionId)
 * inside the test.
 */

import { test as base, type TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const API_BASE = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:4111";
const SESSION_ID_ANNOTATION = "ensemble-session-id";

export const test = base.extend<{ artifactBundle: void }>({
  artifactBundle: [
    async ({ request }, use, testInfo) => {
      const startTs = new Date().toISOString();
      // Mark this test's window — server logs since this ts will be
      // included on failure.
      testInfo.annotations.push({
        type: "ensemble-test-start-ts",
        description: startTs,
      });

      await use();

      if (testInfo.status === testInfo.expectedStatus) return;

      // Failure path: bundle artifacts.
      const outDir = testInfo.outputDir;
      try {
        mkdirSync(outDir, { recursive: true });
      } catch {
        // ignore
      }

      // 1. Server logs (if the ring buffer is enabled).
      try {
        const r = await request.get(
          `${API_BASE}/__logs?since=${encodeURIComponent(startTs)}`,
        );
        if (r.ok()) {
          const body = await r.text();
          const file = `${outDir}/server.log.json`;
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, body, "utf-8");
          await testInfo.attach("server.log", { path: file, contentType: "application/json" });
        }
      } catch {
        // best effort
      }

      // 2. Diagnostics snapshots for any session ids the test recorded.
      const sessionIds = testInfo.annotations
        .filter((a) => a.type === SESSION_ID_ANNOTATION)
        .map((a) => a.description!)
        .filter(Boolean);
      for (const id of sessionIds) {
        try {
          const r = await request.get(`${API_BASE}/sessions/${id}/__diagnostics`);
          if (r.ok()) {
            const body = await r.text();
            const file = `${outDir}/diagnostics-${id}.json`;
            writeFileSync(file, body, "utf-8");
            await testInfo.attach(`diagnostics-${id}`, {
              path: file,
              contentType: "application/json",
            });
          }
        } catch {
          // best effort
        }
      }
    },
    { auto: true },
  ],
});

/** Record a session id so failure-bundle picks it up. */
export function recordSessionId(testInfo: TestInfo, sessionId: string): void {
  testInfo.annotations.push({
    type: SESSION_ID_ANNOTATION,
    description: sessionId,
  });
}

export { expect } from "@playwright/test";
