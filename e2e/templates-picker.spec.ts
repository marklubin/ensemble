import { expect, test } from "@playwright/test";

/**
 * L5 E2E — templates picker.
 *
 * Prerequisites:
 *   - `bun install` at the repo root.
 *   - `bun x playwright install chromium` (one-time browser download).
 *   - For Phase 1, the server doesn't need to be running. The api-client
 *     falls back to the hardcoded mock templates when /templates 404s.
 *
 * NOTE: this test assumes the router has been wired to mount
 * `TemplatesScreen` at `/` (see HANDOFF.md). Until the orchestrator
 * lands that one-line edit at Phase 2, the test is expected to fail —
 * which is the signal that wiring is still pending.
 */
test.describe("templates picker", () => {
  test("renders the default template grid and navigates to /casting", async ({ page }) => {
    await page.goto("/");

    // Lead heading present
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText("Who's at the table");

    // The two default templates render
    const debateCard = page.getByTestId("template-card-debate");
    const roundtableCard = page.getByTestId("template-card-roundtable");
    await expect(debateCard).toBeVisible();
    await expect(roundtableCard).toBeVisible();

    // Each card has a name, description, and cast-count line.
    await expect(debateCard.locator(".tp-name")).toHaveText("Debate");
    await expect(debateCard.locator(".tp-tagline")).not.toBeEmpty();
    await expect(debateCard.locator(".tp-meta")).toContainText(/past debate/);

    await expect(roundtableCard.locator(".tp-name")).toHaveText("Roundtable");
    await expect(roundtableCard.locator(".tp-tagline")).not.toBeEmpty();
    await expect(roundtableCard.locator(".tp-meta")).toContainText(/past roundtable/);

    // Clicking "Use Debate →" navigates to the casting screen pre-filled.
    await page.getByTestId("use-debate").click();
    await expect(page).toHaveURL(/\/casting\?template=debate$/);
  });

  test("clicking 'Use Roundtable' navigates with the correct query string", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("use-roundtable").click();
    await expect(page).toHaveURL(/\/casting\?template=roundtable$/);
  });
});
