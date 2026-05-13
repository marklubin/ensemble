/**
 * L5 @prod post-deploy smoke. Tagged `@prod` so it's excluded from
 * regular runs; deploy.yml runs it after every Fly deploy with
 * `PLAYWRIGHT_BASE_URL=https://ensemble-app.fly.dev`.
 *
 * What this catches that the fixture suite can't: Docker layer bugs,
 * env-var typos, secret rotation issues, static-asset serving from
 * production, Fly proxy/SSE compatibility, real Anthropic auth.
 *
 * Cost: ~1 real Anthropic round on Haiku 4.5, target <$0.02/run.
 *
 * No reset (we don't have a __reset endpoint in prod — testMode is
 * `live`). The spec creates a fresh session, starts it, asserts a
 * turn streams within a generous window, ends it.
 */

import { test, expect } from "@playwright/test";

const TIMEOUT_MS = 60_000;

test.describe("@prod smoke", () => {
  test.setTimeout(TIMEOUT_MS + 30_000);

  test("@prod: deployed app boots, /health returns runtimes, a real session streams one turn", async ({
    request,
    page,
  }) => {
    const base = process.env.PLAYWRIGHT_BASE_URL ?? "";
    if (!base) {
      test.skip(true, "PLAYWRIGHT_BASE_URL not set; skipping prod smoke");
      return;
    }

    // 1. /health is up.
    const health = await request.get(`${base}/health`);
    expect(health.ok(), "GET /health").toBe(true);
    const healthBody = await health.json();
    expect(healthBody.ok).toBe(true);
    expect(healthBody.runtimes).toContain("managed-agents");
    expect(healthBody.runtimes).toContain("human");

    // 2. /templates returns the v1 presets.
    const templates = await request.get(`${base}/templates`);
    expect(templates.ok(), "GET /templates").toBe(true);
    const tpls = (await templates.json()) as Array<{ id: string }>;
    expect(tpls.map((t) => t.id).sort()).toEqual(["debate", "roundtable"]);

    // 3. /personas seeded.
    const personas = await request.get(`${base}/personas`);
    expect(personas.ok(), "GET /personas").toBe(true);
    const ps = (await personas.json()) as Array<{ id: string }>;
    expect(ps.length).toBeGreaterThanOrEqual(2);

    // 4. Create + start a real 1-round Debate session.
    const personaA = ps[0]!.id;
    const personaB = ps[1]!.id;
    const create = await request.post(`${base}/sessions`, {
      data: {
        template_id: "debate",
        scenario: "prod smoke: is bun ready for production?",
        cast: [
          {
            seat_id: "pro",
            persona_id: personaA,
            persona_name: "PersonaA",
            role: "Pro",
            runtime_type: "managed-agents",
          },
          {
            seat_id: "con",
            persona_id: personaB,
            persona_name: "PersonaB",
            role: "Con",
            runtime_type: "managed-agents",
          },
        ],
        turn_taking_mode: "shuffled",
        length: { kind: "n_rounds", n: 1 },
      },
    });
    expect(create.ok(), `POST /sessions: ${await create.text()}`).toBe(true);
    const { session_id } = (await create.json()) as { session_id: string };
    expect(session_id).toMatch(/^sess_/);

    const start = await request.post(`${base}/sessions/${session_id}/start`);
    expect(start.ok(), `POST /start: ${await start.text()}`).toBe(true);

    // 5. Poll diagnostics until the session ends or we time out.
    const deadline = Date.now() + TIMEOUT_MS;
    let last: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      const r = await request.get(
        `${base}/sessions/${session_id}/__diagnostics`,
      );
      if (r.ok()) {
        last = (await r.json()) as Record<string, unknown>;
        if (last.ended === true) break;
      }
      await new Promise((res) => setTimeout(res, 1_500));
    }
    expect(last.ended, `session never ended: ${JSON.stringify(last)}`).toBe(
      true,
    );
    expect(last.pending_runtime_errors).toEqual([]);

    // 6. Smoke the web shell renders.
    await page.goto("/");
    await expect(page.getByTestId("template-card-debate")).toBeVisible();
  });
});
