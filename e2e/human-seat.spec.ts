/**
 * L5 — Human seat: server sends UiBridge `focus`, client autofocuses,
 * characters are streamed as `chunk` messages, Submit ends the turn.
 *
 * Coordinated with Agent E's brief: G owns the client-side, E owns the
 * server-side. This test exercises both via the test-only fixture
 * harness, skipped pending wiring.
 */
import { test, expect } from "@playwright/test";

test.skip("L5: human seat autofocuses and streams typed chunks", async ({ page }) => {
  // The test harness should boot a session with a human seat whose turn
  // is the first turn of round 1. Server emits ui-bridge `focus`.
  await page.goto("/session/human-seat-fixture");

  const textarea = page.locator('[data-testid="session-dock-textarea"]');
  await expect(textarea).toBeFocused();

  await textarea.type("hello");
  // Each keystroke should have produced a POST /ui-bridge/messages with
  // a `chunk` payload. Diagnostics endpoint sums these.
  await page.click('[data-testid="session-dock"] >> text=Submit');

  // After submit, the turn ends and a new card appears.
  await expect(page.locator('[data-testid="session-turn"]').last()).toContainText("hello");
});

test.skip("L5: buzz-in (poll mode) posts intent and intensity", async ({ page }) => {
  await page.goto("/session/poll-mode-fixture");
  const buzz = page.locator('[data-testid="session-buzz"]');
  await buzz.locator("input").fill("I disagree with that framing");
  await buzz.locator("text=Buzz in").click();
  // Server-side: validate buzzer.press received intent=… and intensity=8
});
