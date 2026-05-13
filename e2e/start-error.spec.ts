/**
 * L5 — start-error: if /start fails on the server, the UI must not
 * sit silent. This guards the "permanent nothing happening" failure
 * mode in general (not just the specific missed-useEffect bug).
 *
 * We force a 500 from /start by deleting the session between create
 * and start: the client navigates to /session/<id>, mounts, fires
 * POST /start, and the server returns 404. That should surface in
 * the DevTools console at minimum, and ideally in a visible toast.
 *
 * If/when a UI error surface lands (`[data-testid="session-error"]`),
 * extend this spec. For v1, we assert at the network/console level.
 */

import { test, expect } from "@playwright/test";
import { resetServer } from "./_helpers/harness.ts";

test.beforeEach(async ({ request }) => {
  await resetServer(request, "default");
});

test("hitting a non-existent session id surfaces an error, not silence", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Bogus id — the server will return 404 on both /sessions/:id and
  // /sessions/:id/start. The session screen mounts and we expect
  // the start-call useEffect to log an error.
  await page.goto("/session/bogus-session-id");

  // Give the start-call useEffect time to fire and log.
  await page.waitForTimeout(3_000);

  // We must NOT have zero errors logged — that would mean the start
  // failure is silent.
  expect(
    consoleErrors.some((e) => /failed to start|error starting/i.test(e)),
    `expected at least one '[session] failed to start' console error, got: ${consoleErrors.join(" | ")}`,
  ).toBe(true);
});
