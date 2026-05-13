import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { MemoryStore } from "./store.ts";
import { createMemoryRoutes } from "./routes.ts";
import { sessionStore } from "../session/store.ts";
import type { SessionState } from "../session/store.ts";
import { EventBus } from "../scheduler/index.ts";

function makeSessionState(id: string): SessionState {
  return {
    session_id: id,
    template_id: "t",
    scenario: "s",
    scenario_format: "open",
    cast: [],
    turn_taking_mode: "round-robin",
    length: { kind: "open-ended" },
    bus: new EventBus(),
    scheduler: null,
    handles: new Map(),
    runtimes: new Map(),
    detachedHandles: [],
    eventCount: 0,
    started_at: null,
    start_called: false,
    start_response_status: null,
    last_sse_chunk_at: null,
    pending_runtime_errors: [],
    status: "created",
    created_at: new Date().toISOString(),
  };
}

describe("memory routes", () => {
  beforeEach(() => {
    // Clear any session state left over from previous tests.
    for (const s of sessionStore.list()) sessionStore.delete(s.session_id);
  });

  test("404 if session doesn't exist", async () => {
    const a = new Hono();
    a.route("/sessions", createMemoryRoutes(new MemoryStore()));
    const r = await a.request("/sessions/missing/memory/alice");
    expect(r.status).toBe(404);
  });

  test("write → read → delete round-trip", async () => {
    sessionStore.create(makeSessionState("s1"));
    const mem = new MemoryStore();
    const a = new Hono();
    a.route("/sessions", createMemoryRoutes(mem));

    const put = await a.request("/sessions/s1/memory/alice/topic", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: { stance: "pro" } }),
    });
    expect(put.status).toBe(200);

    const get = await a.request("/sessions/s1/memory/alice/topic");
    expect(get.status).toBe(200);
    const j = (await get.json()) as { value: unknown; exists: boolean };
    expect(j.exists).toBe(true);
    expect(j.value).toEqual({ stance: "pro" });

    const list = await a.request("/sessions/s1/memory/alice");
    const lj = (await list.json()) as { keys: string[] };
    expect(lj.keys).toEqual(["topic"]);

    const del = await a.request("/sessions/s1/memory/alice/topic", {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const final = await a.request("/sessions/s1/memory/alice/topic");
    const fj = (await final.json()) as { exists: boolean };
    expect(fj.exists).toBe(false);
  });

  test("PUT accepts a raw value (not just envelope)", async () => {
    sessionStore.create(makeSessionState("s2"));
    const mem = new MemoryStore();
    const a = new Hono();
    a.route("/sessions", createMemoryRoutes(mem));

    const put = await a.request("/sessions/s2/memory/alice/n", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(42),
    });
    expect(put.status).toBe(200);
    const get = await a.request("/sessions/s2/memory/alice/n");
    const j = (await get.json()) as { value: unknown };
    expect(j.value).toBe(42);
  });
});
