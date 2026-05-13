/**
 * L5 — Human seat E2E.
 *
 * Skipped until Agent G ships the in-session web UI for the human seat.
 * When unskipped, this spec:
 *
 * 1. Configures a session with one human seat (via the pre-session UI
 *    Agent F builds).
 * 2. Starts the session.
 * 3. When the human's turn comes, asserts the textarea receives focus
 *    within 200 ms (driven by an SSE `focus` event from the UiBridge).
 * 4. Types characters and asserts each appears in the transcript
 *    character-by-character (the UI POSTs `chunk` messages to the bridge
 *    as the user types; other seats' transcripts mirror them live).
 * 5. Clicks Submit and asserts the turn ends — textarea blurs, the next
 *    seat takes a turn.
 *
 * The selectors below mirror the structure described in Agent G's brief
 * but are placeholders; Agent G owns the actual DOM and may pin them in a
 * follow-up.
 */

import { expect, test } from "@playwright/test";

test.describe.skip("human seat — live streaming + submit", () => {
  test("typed characters appear in the transcript live, submit ends the turn", async ({
    page,
  }) => {
    // 1. Pre-session: cast a human seat
    await page.goto("/");
    await page.getByRole("button", { name: /new session/i }).click();
    await page.getByLabel(/scenario/i).fill("Should we ship Friday?");
    await page.getByRole("button", { name: /add human seat/i }).click();
    await page.getByLabel(/your name/i).fill("Mark");
    await page.getByRole("button", { name: /start session/i }).click();

    // 2. Wait for the human's turn — UiBridge SSE `focus` event focuses the textarea.
    const textarea = page.getByRole("textbox", { name: /your turn/i });
    await expect(textarea).toBeFocused({ timeout: 1000 });

    // 3. Type and assert per-character appearance in the transcript.
    const text = "I think we should wait.";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      await textarea.press(ch);
      const live = page.getByTestId("transcript-live");
      await expect(live).toContainText(text.slice(0, i + 1), {
        timeout: 200,
      });
    }

    // 4. Submit ends the turn.
    await page.getByRole("button", { name: /submit/i }).click();
    await expect(textarea).not.toBeFocused();
    // The final transcript line attributes the content to the human seat.
    const finalLine = page.getByTestId("transcript-final").last();
    await expect(finalLine).toContainText("Mark:");
    await expect(finalLine).toContainText(text);
  });
});
