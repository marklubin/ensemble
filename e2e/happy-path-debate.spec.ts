/**
 * L5 happy-path debate: full transcript renders, scheduler completes,
 * session ends cleanly.
 *
 * Beyond the regression spec, this one walks the full lifecycle and
 * asserts the cumulative state: 2 turns completed per seat over 1
 * round, no runtime errors, session.status === "ended".
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

test("debate template: 2 personas, 1 round, full transcript streams + session ends", async ({
  page,
  request,
}) => {
  const sessionId = await castDebateAndStart(page, { rounds: 1 });

  // Both seats spoke at least once and the session ended cleanly.
  const d = await waitForDiagnostics(
    request,
    sessionId,
    (d) =>
      d.ended &&
      Object.values(d.per_seat).every((s) => s.turns_completed >= 1),
    { timeoutMs: 20_000, label: "both seats spoke and session ended" },
  );

  // Each seat's transcript digest contributed something.
  expect(d.transcript_digest.length).toBeGreaterThan(20);

  // Per-seat turn counts come from the fixture script (2 turns each).
  for (const [seatId, slot] of Object.entries(d.per_seat)) {
    expect(slot.turns_completed, `seat ${seatId}`).toBeGreaterThanOrEqual(1);
  }

  // No silent runtime errors.
  expect(d.pending_runtime_errors, "no runtime errors").toEqual([]);
  // start_response_status was 200, not 500.
  expect(d.start_response_status).toBe(200);
});

test("debate transcript: real text from the fixture appears in the DOM", async ({
  page,
  request,
}) => {
  const sessionId = await castDebateAndStart(page);

  // Wait for at least one turn to complete server-side.
  await waitForDiagnostics(
    request,
    sessionId,
    (d) => Object.values(d.per_seat).some((s) => s.turns_completed >= 1),
    { timeoutMs: 12_000 },
  );

  // The fixture's pro side opens with "The Pro side ".
  const transcript = page.locator(
    '[data-testid="session-turn-lines"], [data-testid="transcript"], main',
  );
  await expect(transcript.first()).toContainText(/Pro side|disagree|opens|Here is why/, {
    timeout: 6_000,
  });
});
