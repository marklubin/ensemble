/**
 * E2E harness helpers. Stable selectors + diagnostics endpoint
 * helpers + the per-test reset coordination.
 *
 * The server boots once per Playwright run (Playwright's `webServer`).
 * Per-test isolation comes from `resetServer()` in `test.beforeEach`,
 * which (a) wipes the in-memory session store and (b) swaps the
 * active fixture bucket. No DB-per-test, no server-per-test.
 */

import type { APIRequestContext, Page } from "@playwright/test";

/** Default API base URL — Playwright proxies the web app at :5173 to the API at :4111. */
const API_BASE = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:4111";

/**
 * Wipe the session store and optionally switch fixture buckets.
 * Call in `test.beforeEach` so specs start hermetic.
 */
export async function resetServer(
  request: APIRequestContext,
  fixture: string = "default",
): Promise<void> {
  const r = await request.post(`${API_BASE}/sessions/__reset`, {
    data: { fixture },
  });
  if (!r.ok()) {
    throw new Error(
      `resetServer: POST __reset returned ${r.status()}: ${await r.text()}`,
    );
  }
}

export interface Diagnostics {
  active_handles: string[];
  detached_handles: string[];
  event_count: number;
  ended: boolean;
  status: "created" | "running" | "ended";
  start_called: boolean;
  start_response_status: number | null;
  started_at: string | null;
  last_sse_chunk_at: string | null;
  pending_runtime_errors: string[];
  per_seat: Record<
    string,
    { turns_completed: number; cooldown_remaining: number; bypass_count: number }
  >;
  transcript_digest: string;
}

export async function getDiagnostics(
  request: APIRequestContext,
  sessionId: string,
): Promise<Diagnostics> {
  const r = await request.get(`${API_BASE}/sessions/${sessionId}/__diagnostics`);
  if (!r.ok()) {
    throw new Error(`getDiagnostics: ${r.status()}: ${await r.text()}`);
  }
  return (await r.json()) as Diagnostics;
}

/** Wait until `pred(d)` is true on the diagnostics endpoint. */
export async function waitForDiagnostics(
  request: APIRequestContext,
  sessionId: string,
  pred: (d: Diagnostics) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<Diagnostics> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let last: Diagnostics | undefined;
  while (Date.now() < deadline) {
    last = await getDiagnostics(request, sessionId);
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForDiagnostics${opts.label ? ` (${opts.label})` : ""}: predicate never satisfied. ` +
      `last=${JSON.stringify(last, null, 2)}`,
  );
}

/**
 * Extract the session id from the URL of the session screen.
 * Pattern: `/session/<id>`.
 */
export function sessionIdFromUrl(url: string): string {
  const m = url.match(/\/session\/([^?#]+)/);
  if (!m) throw new Error(`no session id in URL: ${url}`);
  return decodeURIComponent(m[1]!);
}

/**
 * Drive the casting screen for a 2-persona Debate. Returns the
 * session id once we land on the session screen. Uses stable
 * data-testid attributes; falls back to role-based locators where the
 * screen's existing markup doesn't have one.
 */
export async function castDebateAndStart(
  page: Page,
  opts: { scenario?: string; rounds?: number } = {},
): Promise<string> {
  const scenario = opts.scenario ?? "Should we standardize on Bun?";
  const rounds = opts.rounds ?? 1;

  await page.goto("/");
  await page.getByTestId("use-debate").click();
  await page.waitForURL(/\/casting/);

  // Fill the scenario textarea.
  await page.getByTestId("scenario-input").fill(scenario);

  // The casting screen has two seats seeded by default. Each seat has
  // a persona <select>. Pick the first available persona in each, then
  // ensure roles are Pro/Con (template constraint).
  const seats = page.getByTestId(/^cast-seat-\d+$/);
  const seatCount = await seats.count();
  for (let i = 0; i < seatCount; i++) {
    const seat = seats.nth(i);
    const selects = seat.locator("select");
    const n = await selects.count();
    // Convention: first select = persona, second = role, third = runtime.
    if (n >= 1) {
      // Pick a non-empty persona option (first non-default value).
      const opts = await selects.nth(0).locator("option").all();
      let chose = false;
      for (const o of opts) {
        const v = (await o.getAttribute("value")) ?? "";
        if (v && v !== "" && v !== "—") {
          await selects.nth(0).selectOption(v);
          chose = true;
          break;
        }
      }
      if (!chose) throw new Error("no persona option to select");
    }
    if (n >= 2) {
      const role = i === 0 ? "Pro" : "Con";
      try {
        await selects.nth(1).selectOption(role);
      } catch {
        // role select may be optional / absent depending on template
      }
    }
  }

  // Length: leave default open-ended unless we explicitly want N rounds.
  if (opts.rounds) {
    // Click the n-rounds radio (its sibling number input becomes editable)
    const roundsRadio = page.locator(
      'input[type="radio"][name="length"]:not(:checked)',
    );
    if (await roundsRadio.count() > 0) {
      await roundsRadio.first().click();
    }
    const roundsNum = page.getByLabel("Number of rounds");
    if (await roundsNum.count() > 0) {
      await roundsNum.fill(String(rounds));
    }
  }

  await page.getByTestId("cast-submit").click();
  await page.waitForURL(/\/session\//, { timeout: 10_000 });

  return sessionIdFromUrl(page.url());
}
