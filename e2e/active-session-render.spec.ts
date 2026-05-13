/**
 * L5 — Active session screen renders from a scripted SSE feed.
 *
 * Skipped pending Phase 2 orchestrator wiring + Playwright installation.
 * The fixture stream is driven by a test-only endpoint the server should
 * expose at `/__test/sse?fixture=debate-r3`; the contract is in
 * apps/web/HANDOFF.md.
 */
import { test } from "@playwright/test";

test.skip("L5: streaming transcript renders, queue chips advance, no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/session/debate-r3?moderator=1");

  // First turn streams in
  await page.waitForSelector('[data-testid="session-turn"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="session-turn-lines"]');
    return !!el && (el.textContent ?? "").length > 50;
  });

  // Queue chips reflect the round's order
  const chips = await page.$$('[data-testid="session-queue-chip"]');
  if (chips.length < 3) throw new Error("expected at least 3 queue chips");

  // Auto-scrolls
  await page.waitForFunction(() => window.scrollY > 0 || document.scrollingElement!.scrollTop > 0);

  if (errors.length > 0) {
    throw new Error(`console errors: ${errors.join("\n")}`);
  }
});
