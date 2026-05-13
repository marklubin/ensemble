/**
 * L5 memory: server-backed memory CRUD round-trips. The Phase 3 work
 * focuses on the API contract — once the panel UI lands (separate
 * follow-up), this spec extends to click through the panel itself.
 *
 * What this validates:
 *   - PUT /sessions/:id/memory/:seat/:key writes a value
 *   - GET /sessions/:id/memory/:seat/:key reads it back
 *   - GET /sessions/:id/memory/:seat lists keys
 *   - DELETE removes the key
 *
 * If this fails: the memory panel will not work end-to-end in the UI.
 */

import { test, expect, recordSessionId } from "./_helpers/diagnostics-fixture.ts";
import {
  castDebateAndStart,
  resetServer,
  waitForDiagnostics,
} from "./_helpers/harness.ts";

const API_BASE = "http://localhost:4111";

test.beforeEach(async ({ request }) => {
  await resetServer(request, "default");
});

test("memory CRUD round-trips through the session-scoped API", async ({
  page,
  request,
}, testInfo) => {
  const sessionId = await castDebateAndStart(page, { rounds: 1 });
  recordSessionId(testInfo, sessionId);

  const d0 = await waitForDiagnostics(
    request,
    sessionId,
    (d) => d.start_called === true && Object.keys(d.per_seat).length >= 1,
    { timeoutMs: 3_000 },
  );
  // Use the actual seat id (auto-generated as `seat-N`), not the role.
  const seat = Object.keys(d0.per_seat)[0]!;

  // PUT — write a key.
  const w = await request.put(
    `${API_BASE}/sessions/${sessionId}/memory/${seat}/my-key`,
    { data: { value: "hello" } },
  );
  expect(w.ok(), `PUT memory: ${w.status()} ${await w.text()}`).toBe(true);

  // GET — read it back.
  const r = await request.get(
    `${API_BASE}/sessions/${sessionId}/memory/${seat}/my-key`,
  );
  expect(r.ok(), `GET memory: ${r.status()} ${await r.text()}`).toBe(true);
  const got = (await r.json()) as { value: unknown };
  expect(got.value).toBe("hello");

  // LIST — the key appears.
  const list = await request.get(
    `${API_BASE}/sessions/${sessionId}/memory/${seat}`,
  );
  expect(list.ok()).toBe(true);
  const all = (await list.json()) as { keys: string[]; values: Record<string, unknown> };
  expect(all.keys).toContain("my-key");
  expect(all.values["my-key"]).toBe("hello");

  // DELETE — gone after.
  const del = await request.delete(
    `${API_BASE}/sessions/${sessionId}/memory/${seat}/my-key`,
  );
  expect(del.ok()).toBe(true);
  const after = await request.get(
    `${API_BASE}/sessions/${sessionId}/memory/${seat}`,
  );
  const afterBody = (await after.json()) as { keys: string[] };
  expect(afterBody.keys).not.toContain("my-key");
});
