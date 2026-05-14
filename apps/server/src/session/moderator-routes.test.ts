import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { sessions } from "./routes.ts";
import { createModeratorRoutes } from "./moderator-routes.ts";
import { sessionStore } from "./store.ts";
import type { SessionState } from "./store.ts";
import { EventBus, SessionScheduler } from "../scheduler/index.ts";

function makeRunningSession(id: string): SessionState {
  const bus = new EventBus();
  const cast = [
    {
      seat_id: "s1",
      persona_id: "alice",
      persona_name: "Alice",
      runtime_type: "human" as const,
    },
    {
      seat_id: "s2",
      persona_id: "bob",
      persona_name: "Bob",
      runtime_type: "human" as const,
    },
  ];
  const state: SessionState = {
    session_id: id,
    template_id: "t",
    scenario: "s",
    scenario_format: "open",
    cast,
    turn_taking_mode: "round-robin",
    length: { kind: "open-ended" },
    bus,
    scheduler: null,
    handles: new Map(),
    runtimes: new Map(),
    detachedHandles: [],
    eventCount: 0,
    started_at: null,
    target_words_per_turn: 120,
    start_called: false,
    start_response_status: null,
    last_sse_chunk_at: null,
    pending_runtime_errors: [],
    status: "created",
    created_at: new Date().toISOString(),
  };
  state.scheduler = new SessionScheduler({
    sessionId: id,
    mode: "round-robin",
    seats: cast,
    handles: state.handles,
    runtimes: state.runtimes,
    bus,
  });
  return state;
}

function app() {
  const a = new Hono();
  a.route("/sessions", sessions);
  a.route("/sessions", createModeratorRoutes());
  return a;
}

describe("moderator proxy routes", () => {
  beforeEach(() => {
    for (const s of sessionStore.list()) sessionStore.delete(s.session_id);
  });

  test("404 when session missing", async () => {
    const r = await app().request("/sessions/missing/moderator/inject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(r.status).toBe(404);
  });

  test("409 when scheduler not running", async () => {
    sessionStore.create({
      ...makeRunningSession("nope"),
      scheduler: null,
    });
    const r = await app().request("/sessions/nope/moderator/inject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(r.status).toBe(409);
  });

  test("force_speaker accepted", async () => {
    sessionStore.create(makeRunningSession("a"));
    const r = await app().request("/sessions/a/moderator/force_speaker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat_id: "s1" }),
    });
    expect(r.status).toBe(200);
  });

  test("cooldown publishes a cooldown.applied event", async () => {
    const state = makeRunningSession("b");
    sessionStore.create(state);
    let saw = false;
    state.bus.subscribe((e) => {
      if (e.type === "cooldown.applied") saw = true;
    });
    const r = await app().request("/sessions/b/moderator/cooldown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat_id: "s1", rounds: 2, reason: "test" }),
    });
    expect(r.status).toBe(200);
    expect(saw).toBe(true);
  });

  test("inject publishes a moderator.message event", async () => {
    const state = makeRunningSession("c");
    sessionStore.create(state);
    let saw = false;
    state.bus.subscribe((e) => {
      if (e.type === "moderator.message") saw = true;
    });
    const r = await app().request("/sessions/c/moderator/inject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "stop right there" }),
    });
    expect(r.status).toBe(200);
    expect(saw).toBe(true);
  });

  test("bypass treated as 1-round cooldown", async () => {
    sessionStore.create(makeRunningSession("d"));
    const r = await app().request("/sessions/d/moderator/bypass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat_id: "s2", reason: "off-topic" }),
    });
    expect(r.status).toBe(200);
  });

  test("invalid body returns 400", async () => {
    sessionStore.create(makeRunningSession("e"));
    const r = await app().request("/sessions/e/moderator/cooldown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat_id: "s1" }),
    });
    expect(r.status).toBe(400);
  });

  test("unknown tool returns 400", async () => {
    sessionStore.create(makeRunningSession("f"));
    const r = await app().request("/sessions/f/moderator/teleport", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });
});
