/**
 * L5 happy-path Roundtable: 2 personas, 1 round, no Pro/Con constraint.
 *
 * The fixture's seat-id-keyed scripts won't match the auto-generated
 * seat ids; the fixture-runtime falls back to "(<persona>) speaks." /
 * "(<persona>) responds." which is enough to verify the scheduler
 * actually runs and the screen renders chunks.
 */

import { test, expect } from "@playwright/test";
import {
  castRoundtableAndStart,
  resetServer,
  waitForDiagnostics,
} from "./_helpers/harness.ts";

test.beforeEach(async ({ request }) => {
  await resetServer(request, "default");
});

test("roundtable: 2 seats run 1 round and the session ends", async ({
  page,
  request,
}) => {
  const sessionId = await castRoundtableAndStart(page, { rounds: 1 });

  const d = await waitForDiagnostics(
    request,
    sessionId,
    (d) =>
      d.ended &&
      Object.values(d.per_seat).every((s) => s.turns_completed >= 1),
    { timeoutMs: 20_000, label: "all seats spoke and ended" },
  );

  expect(d.pending_runtime_errors).toEqual([]);
  expect(d.transcript_digest.length).toBeGreaterThan(10);
});
