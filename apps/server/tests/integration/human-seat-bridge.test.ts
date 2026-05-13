/**
 * L4 — Human seat ↔ UiBridge ↔ Scheduler integration.
 *
 * NOTE on Agent A dependency: Agent A's scheduler isn't merged yet. The
 * Phase-0 skeleton at `apps/server/src/scheduler/index.ts` already has
 * enough surface (`SessionScheduler` with `runTurn` walking
 * `runtime.takeTurn(handle, events)` and accumulating chunks into a
 * transcript event) for this test to drive a single turn end-to-end.
 *
 * When the real scheduler lands, this test should still pass — but the
 * assertions narrow to: "the chunks the client POSTs over HTTP land in
 * the scheduler's event log as a single `turn` event with the
 * concatenated content."
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { EventBus, SessionScheduler } from "../../src/scheduler/index.ts";
import { UiBridge } from "../../src/ui-bridge/index.ts";
import { HumanRuntime } from "../../src/runtimes/human/index.ts";
import type {
  InstanceHandle,
  PersonaRuntime,
  PersonaSpec,
  SeatInfo,
  SessionContext,
} from "@ensemble/shared";

async function postMessage(
  app: Hono,
  session_id: string,
  message: unknown,
): Promise<Response> {
  return app.request("/ui-bridge/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, message }),
  });
}

describe("human seat ↔ UiBridge integration (single-turn)", () => {
  test("client POSTs chunks; scheduler.runTurn appends a turn event with the concatenated content", async () => {
    const bridge = new UiBridge();
    const runtime = new HumanRuntime(bridge);

    // Mount the bridge routes on a Hono app, mirroring how the real
    // server wires them (`app.route("/ui-bridge", uiBridge.routes)`).
    const app = new Hono();
    app.route("/ui-bridge", bridge.routes);

    const persona: PersonaSpec = {
      id: "p1",
      name: "Mark",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctx: SessionContext = {
      session_id: "s1",
      seat_id: "seat-human",
      scenario: "test scenario",
      scenario_format: "open",
      cast: [],
      ensemble_mcp_url: "http://localhost/mcp",
      ensemble_mcp_token: "t",
    };
    const handle = await runtime.attach(persona, ctx);

    const seat: SeatInfo = {
      seat_id: "seat-human",
      persona_id: "p1",
      persona_name: "Mark",
      runtime_type: "human",
    };
    const handles = new Map<string, InstanceHandle>([[seat.seat_id, handle]]);
    const runtimes = new Map<string, PersonaRuntime>([[seat.seat_id, runtime]]);
    const bus = new EventBus();
    const scheduler = new SessionScheduler({
      sessionId: "s1",
      mode: "round-robin",
      seats: [seat],
      handles,
      runtimes,
      bus,
    });

    // Pre-determine the turn id the runtime will emit. Since the scheduler
    // calls runtime.takeTurn synchronously, the turn id is `${handle.id}-turn-1`.
    const turn_id = `${handle.id}-turn-1`;

    // Drive the round, and concurrently POST chunks + submit into the bridge.
    const runPromise = scheduler.runRound();

    // Give the scheduler a microtask to invoke takeTurn → emitFocus → inboundFor.
    await new Promise((r) => setTimeout(r, 5));

    const res1 = await postMessage(app, "s1", {
      kind: "chunk",
      seat_id: "seat-human",
      turn_id,
      text: "Hello, ",
    });
    expect(res1.status).toBe(200);
    const res2 = await postMessage(app, "s1", {
      kind: "chunk",
      seat_id: "seat-human",
      turn_id,
      text: "world.",
    });
    expect(res2.status).toBe(200);
    const res3 = await postMessage(app, "s1", {
      kind: "submit",
      seat_id: "seat-human",
      turn_id,
    });
    expect(res3.status).toBe(200);

    await runPromise;

    // The scheduler's events array is private — read it via the only
    // observable contract (current Phase-0 surface): re-runRound would
    // re-walk it; instead we cast through `unknown` to access for the
    // assertion. When Agent A merges, replace this with the public
    // accessor they provide.
    const events = (scheduler as unknown as { events: unknown[] }).events as Array<{
      kind: string;
      seat_id?: string;
      content?: string;
    }>;
    const turnEvents = events.filter((e) => e.kind === "turn");
    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0]?.seat_id).toBe("seat-human");
    expect(turnEvents[0]?.content).toBe("Hello, world.");

    await runtime.detach(handle);
  });

  test("cancel mid-turn ends the turn with whatever streamed so far", async () => {
    const bridge = new UiBridge();
    const runtime = new HumanRuntime(bridge);
    const app = new Hono();
    app.route("/ui-bridge", bridge.routes);

    const persona: PersonaSpec = {
      id: "p1",
      name: "Mark",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctx: SessionContext = {
      session_id: "s2",
      seat_id: "seat-human",
      scenario: "",
      scenario_format: "open",
      cast: [],
      ensemble_mcp_url: "http://localhost/mcp",
      ensemble_mcp_token: "t",
    };
    const handle = await runtime.attach(persona, ctx);
    const seat: SeatInfo = {
      seat_id: "seat-human",
      persona_id: "p1",
      persona_name: "Mark",
      runtime_type: "human",
    };
    const handles = new Map([[seat.seat_id, handle]]);
    const runtimes = new Map<string, PersonaRuntime>([[seat.seat_id, runtime]]);
    const bus = new EventBus();
    const scheduler = new SessionScheduler({
      sessionId: "s2",
      mode: "round-robin",
      seats: [seat],
      handles,
      runtimes,
      bus,
    });

    const turn_id = `${handle.id}-turn-1`;
    const p = scheduler.runRound();
    await new Promise((r) => setTimeout(r, 5));
    await postMessage(app, "s2", {
      kind: "chunk",
      seat_id: "seat-human",
      turn_id,
      text: "half-",
    });
    await postMessage(app, "s2", {
      kind: "cancel",
      seat_id: "seat-human",
      turn_id,
      reason: "user navigated",
    });
    await p;

    const events = (scheduler as unknown as { events: unknown[] }).events as Array<{
      kind: string;
      content?: string;
    }>;
    const turnEvents = events.filter((e) => e.kind === "turn");
    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0]?.content).toBe("half-");
    await runtime.detach(handle);
  });
});
