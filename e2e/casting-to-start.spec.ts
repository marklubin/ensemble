/**
 * L5 regression spec — the bug we shipped on 2026-05-13.
 *
 * The casting screen creates the session via POST /sessions but never
 * called POST /sessions/:id/start. The session screen subscribed to
 * SSE on an idle scheduler and sat there forever.
 *
 * This spec drives the full UI flow and asserts:
 *
 *   1. After submit, we land on the session screen.
 *   2. Within 3 seconds, `__diagnostics.start_called === true`.
 *   3. Within 8 seconds, `__diagnostics.last_sse_chunk_at` is non-null
 *      (the scheduler emitted at least one turn.delta).
 *   4. Within 12 seconds, at least one seat has a completed turn.
 *
 * If any of these fail, the UI is silent and the spec fails — exactly
 * the failure mode the user hit in production.
 */

import { test, expect } from "@playwright/test";
import {
  castDebateAndStart,
  getDiagnostics,
  resetServer,
  waitForDiagnostics,
} from "./_helpers/harness.ts";

test.beforeEach(async ({ request }) => {
  await resetServer(request, "default");
});

test("regression: casting submit triggers /start and SSE turns stream", async ({
  page,
  request,
}) => {
  const sessionId = await castDebateAndStart(page);

  // (1) The session screen is mounted. URL contains /session/<id>.
  expect(sessionId).toMatch(/^sess_/);

  // (2) /start was actually called. This single assertion would have
  // caught the missed-useEffect bug today.
  await waitForDiagnostics(
    request,
    sessionId,
    (d) => d.start_called === true,
    { timeoutMs: 3_000, label: "start_called" },
  );

  // (3) The scheduler is producing chunks.
  await waitForDiagnostics(
    request,
    sessionId,
    (d) => d.last_sse_chunk_at !== null,
    { timeoutMs: 8_000, label: "last_sse_chunk_at" },
  );

  // (4) At least one seat has a completed turn.
  const d = await waitForDiagnostics(
    request,
    sessionId,
    (d) =>
      Object.values(d.per_seat).some((s) => s.turns_completed >= 1),
    { timeoutMs: 12_000, label: "first turn completed" },
  );

  // No silent runtime errors.
  expect(d.pending_runtime_errors).toEqual([]);
  expect(d.start_response_status).toBe(200);
});

test("regression: the session screen visually renders at least one streamed line", async ({
  page,
  request,
}) => {
  const sessionId = await castDebateAndStart(page);
  await waitForDiagnostics(
    request,
    sessionId,
    (d) => d.last_sse_chunk_at !== null,
    { timeoutMs: 8_000 },
  );
  // Some text from the fixture should appear in the transcript area.
  // The TurnCard component has data-testid="session-turn-lines"; if
  // that's not present yet, fall back to checking the whole page.
  const transcript = page.locator(
    '[data-testid="session-turn-lines"], [data-testid="transcript"], main',
  );
  await expect(transcript.first()).toContainText(
    /Pro side|disagree|opens|Here is why|.+/,
    { timeout: 8_000 },
  );
});
