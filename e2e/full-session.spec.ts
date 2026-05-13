/**
 * L5 flagship E2E: drive the full Ensemble flow.
 *
 *   1. Boot the server in fixture mode (no live API calls).
 *   2. Open the templates picker, choose Debate.
 *   3. Cast two personas (Pro / Con).
 *   4. Set scenario + length=2 rounds.
 *   5. Start the session.
 *   6. Assert: 2 streamed turns appear in transcript per round.
 *   7. Assert: memory panel shows any persona writes.
 *   8. Hit End; assert `session.end` event surfaces and UI returns
 *      to summary screen.
 *
 * NOTE — currently SKIPPED. This test depends on two screens that are
 * being built by sibling agents in parallel worktrees:
 *   - Agent F (UX pre-session): templates picker + cast-call screen,
 *     routes `/` → `/setup/:templateId`.
 *   - Agent G (UX in-session): live transcript + memory panel,
 *     route `/session/:id`.
 *
 * Once those screens land at the URL routes above, drop the `.skip`
 * suffix. The fixture-mode server is provided by this worktree
 * (`apps/server`, via `bun run dev`) and reaches readiness when
 * `GET /health` returns `{ ok: true }`.
 *
 * Fixture-mode requirements (provided by the orchestrator at merge):
 *   - `ENSEMBLE_TEST_MODE=fixture` — runtime registry uses
 *     `RecordedRuntime` instances scripted to produce the strings
 *     `["Pro side opens.", " I disagree.", "Pro again.", " Still no."]`.
 *   - Memory panel reads from the in-memory MemoryStore which
 *     fixture-mode pre-populates with `key=plan, value=…`.
 */

import { test, expect } from "@playwright/test";

test.skip("full session: templates picker → debate → 2 rounds → end", async ({
  page,
}) => {
  // 1. Open templates picker.
  await page.goto("/");

  // 2. Choose Debate.
  await page.getByRole("button", { name: /debate/i }).click();
  await expect(page).toHaveURL(/\/setup\/debate/);

  // 3. Cast two personas.
  await page.getByRole("button", { name: /add persona/i }).click();
  await page.getByLabel(/role/i).first().selectOption("Pro");
  await page.getByRole("button", { name: /add persona/i }).click();
  await page.getByLabel(/role/i).nth(1).selectOption("Con");

  // 4. Set scenario + length.
  await page.getByLabel(/scenario/i).fill("Cats are better than dogs.");
  await page.getByLabel(/rounds/i).fill("2");

  // 5. Start session.
  await page.getByRole("button", { name: /start/i }).click();
  await expect(page).toHaveURL(/\/session\//);

  // 6. Wait for the 2-rounds × 2-seats transcript (fixture mode).
  const transcript = page.getByTestId("transcript");
  await expect(transcript.getByText(/Pro side opens\./)).toBeVisible();
  await expect(transcript.getByText(/I disagree\./)).toBeVisible();
  await expect(transcript.getByText(/Pro again\./)).toBeVisible();
  await expect(transcript.getByText(/Still no\./)).toBeVisible();

  // 7. Memory panel reflects fixture data.
  await expect(page.getByTestId("memory-panel")).toContainText(/plan/);

  // 8. End the session.
  await page.getByRole("button", { name: /end session/i }).click();
  await expect(page.getByTestId("session-summary")).toBeVisible();
});
