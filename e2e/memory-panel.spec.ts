/**
 * L5 — Memory inspection panel: open, edit, persist across re-open;
 * editing while a turn streams must not race.
 *
 * Skipped pending the server's `GET/PUT/DELETE /sessions/:id/memory/:seat`
 * endpoint and Playwright installation. Contract documented in HANDOFF.md.
 */
import { test, expect } from "@playwright/test";

test.skip("L5: memory edit round-trips and persists", async ({ page }) => {
  await page.goto("/session/debate-r3?moderator=1");
  await page.click('[data-testid="session-mem-btn-seat-jordan"]');
  const panel = page.locator('[data-testid="session-memory-panel"]');
  await expect(panel).toBeVisible();

  await panel.locator("text=Edit").first().click();
  await panel.locator("textarea").first().fill('"updated"');
  await panel.locator("text=Save").click();

  // Re-open and verify persistence
  await panel.locator("text=×").click();
  await page.click('[data-testid="session-mem-btn-seat-jordan"]');
  await expect(panel.locator("text=updated")).toBeVisible();
});

test.skip("L5: editing memory while a turn streams does not corrupt the transcript", async ({ page }) => {
  await page.goto("/session/debate-r3?moderator=1");
  await page.click('[data-testid="session-mem-btn-seat-jordan"]');
  // Wait for at least one turn to start streaming
  await page.waitForSelector('[data-testid="session-turn"]');
  // Edit memory while stream is in flight
  await page.locator('[data-testid="session-memory-panel"] text=Edit').first().click();
  await page.locator('[data-testid="session-memory-panel"] textarea').first().fill('"concurrent"');
  await page.locator('[data-testid="session-memory-panel"] text=Save').click();
  // Transcript should remain coherent — final turn text equals the
  // server's full_text payload (the diagnostics endpoint validates this).
});
