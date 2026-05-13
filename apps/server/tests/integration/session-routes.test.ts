import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  type InstanceHandle,
  type PersonaRuntime,
  type SeatInfo,
} from "@ensemble/shared";

import {
  sessions as sessionsRouter,
  setSessionHandles,
  setSessionRuntimes,
} from "../../src/session/routes.ts";
import { sessionStore } from "../../src/session/store.ts";
import { RecordedRuntime } from "../../src/scheduler/test-helpers/recorded-runtime.ts";

/**
 * L4 integration: drive the HTTP routes directly via Hono's
 * `request()` helper. Verify create → start → events SSE → end.
 */

function makeApp() {
  const app = new Hono();
  app.route("/sessions", sessionsRouter);
  return app;
}

describe("session HTTP routes", () => {
  test("POST /sessions creates a session and returns an id", async () => {
    const app = makeApp();
    const cast: SeatInfo[] = [
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
      { seat_id: "b", persona_id: "pb", persona_name: "Bea", runtime_type: "rec" },
    ];
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_id: "debate",
        scenario: "AI rights",
        scenario_format: "motion",
        cast,
        turn_taking_mode: "round-robin",
        length: { kind: "n_rounds", n: 1 },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { session_id: string };
    expect(typeof json.session_id).toBe("string");
    expect(sessionStore.get(json.session_id)).toBeTruthy();
  });

  test("POST /sessions rejects malformed bodies", async () => {
    const app = makeApp();
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template_id: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /sessions/:id returns 404 when missing", async () => {
    const app = makeApp();
    const res = await app.request("/sessions/nonexistent");
    expect(res.status).toBe(404);
  });

  test("full create → inject runtimes → start → SSE → end flow", async () => {
    const app = makeApp();
    const cast: SeatInfo[] = [
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
      { seat_id: "b", persona_id: "pb", persona_name: "Bea", runtime_type: "rec" },
    ];

    // 1. Create session.
    const createRes = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_id: "debate",
        scenario: "test",
        scenario_format: "motion",
        cast,
        turn_taking_mode: "round-robin",
        length: { kind: "n_rounds", n: 1 },
      }),
    });
    const { session_id } = (await createRes.json()) as { session_id: string };

    // 2. Inject test runtimes + handles before /start.
    const rt = new RecordedRuntime({
      turnChunks: {
        a: [["hello"]],
        b: [["world"]],
      },
    });
    const overrides = new Map<string, PersonaRuntime>([
      ["a", rt],
      ["b", rt],
    ]);
    setSessionRuntimes(session_id, overrides);
    const handles = new Map<string, InstanceHandle>([
      ["a", { id: "ha", seat_id: "a", capabilities: rt.defaultCapabilities }],
      ["b", { id: "hb", seat_id: "b", capabilities: rt.defaultCapabilities }],
    ]);
    setSessionHandles(session_id, handles);

    // 3. Subscribe to SSE BEFORE /start so we catch lifecycle events.
    const sseRes = await app.request(`/sessions/${session_id}/events`);
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

    // Start the scheduler.
    const startRes = await app.request(`/sessions/${session_id}/start`, {
      method: "POST",
    });
    expect(startRes.status).toBe(200);

    // 4. Drain the SSE stream.
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const eventTypes: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        // Server emits unnamed SSE messages (no `event:` line); the
        // event type lives in the JSON payload's `type` field.
        if (line.startsWith("data:")) {
          const json = line.slice("data:".length).trim();
          try {
            const parsed = JSON.parse(json) as { type?: string };
            if (parsed.type) eventTypes.push(parsed.type);
          } catch {
            // skip non-JSON lines
          }
        }
      }
      if (eventTypes.includes("session.end")) break;
    }
    expect(eventTypes).toContain("session.start");
    expect(eventTypes).toContain("turn.start");
    expect(eventTypes).toContain("turn.end");
    expect(eventTypes).toContain("session.end");
  });

  test("POST /sessions/:id/start without runtimes returns 400", async () => {
    const app = makeApp();
    const cast: SeatInfo[] = [
      { seat_id: "x", persona_id: "px", persona_name: "X", runtime_type: "missing" },
    ];
    const createRes = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_id: "any",
        scenario: "s",
        cast,
        turn_taking_mode: "round-robin",
      }),
    });
    const { session_id } = (await createRes.json()) as { session_id: string };
    const startRes = await app.request(`/sessions/${session_id}/start`, {
      method: "POST",
    });
    expect(startRes.status).toBe(400);
  });

  test("POST /sessions/:id/end on a non-existent session returns 404", async () => {
    const app = makeApp();
    const res = await app.request("/sessions/nope/end", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
