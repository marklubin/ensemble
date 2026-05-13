/**
 * L5: SSE reconnect after a page reload mid-stream. The transcript
 * doesn't have to re-render the past (that's a v2 feature), but the
 * session must keep streaming after reconnect so the scheduler reaches
 * `ended` even if the browser navigated away mid-flight.
 */

import { test, expect } from "@playwright/test";
import {
  castDebateAndStart,
  resetServer,
  waitForDiagnostics,
} from "./_helpers/harness.ts";

test.beforeEach(async ({ request }) => {
  await resetServer(request, "default");
});

test("page reload mid-session: scheduler keeps running and reaches end", async ({
  page,
  request,
}) => {
  const sessionId = await castDebateAndStart(page, { rounds: 1 });

  // Wait for the first chunk so we know the scheduler is mid-flight.
  await waitForDiagnostics(
    request,
    sessionId,
    (d) => d.last_sse_chunk_at !== null,
    { timeoutMs: 8_000, label: "first chunk emitted" },
  );

  // Reload — drops the EventSource on the client. Server-side the
  // scheduler keeps running because it's not tied to the SSE subscriber.
  await page.reload();

  // The session must reach `ended` even though the browser dropped.
  const d = await waitForDiagnostics(
    request,
    sessionId,
    (d) => d.ended,
    { timeoutMs: 20_000, label: "session ended after reload" },
  );

  expect(d.pending_runtime_errors).toEqual([]);
  expect(d.event_count).toBeGreaterThan(2);
});
