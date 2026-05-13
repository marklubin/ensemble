/**
 * L1 — HumanRuntime lifecycle + streaming.
 */
import { describe, expect, test } from "bun:test";
import { HumanRuntime } from "./index.ts";
import { UiBridge } from "../../ui-bridge/index.ts";
import type { PersonaSpec, SessionContext } from "@ensemble/shared";

function fixture(): {
  bridge: UiBridge;
  runtime: HumanRuntime;
  persona: PersonaSpec;
  ctx: SessionContext;
} {
  const bridge = new UiBridge();
  const runtime = new HumanRuntime(bridge);
  const persona: PersonaSpec = {
    id: "p-human",
    name: "Mark",
    system_prompt: "",
    tools_allowed: [],
    memory_policy: "ephemeral",
  };
  const ctx: SessionContext = {
    session_id: "s1",
    seat_id: "seat-human",
    scenario: "test",
    scenario_format: "open",
    cast: [
      {
        seat_id: "seat-human",
        persona_id: "p-human",
        persona_name: "Mark",
        runtime_type: "human",
      },
    ],
    ensemble_mcp_url: "http://localhost:4111/mcp",
    ensemble_mcp_token: "test-token",
  };
  return { bridge, runtime, persona, ctx };
}

describe("HumanRuntime lifecycle", () => {
  test("attach registers the seat with the bridge and returns a handle with streaming capability", async () => {
    const { bridge, runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);
    expect(handle.seat_id).toBe(ctx.seat_id);
    expect(handle.capabilities.has("streaming")).toBe(true);
    expect(handle.capabilities.has("buzz_check")).toBe(false);
    expect(bridge.has(ctx.session_id, ctx.seat_id)).toBe(true);
  });

  test("detach unregisters the seat", async () => {
    const { bridge, runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);
    await runtime.detach(handle);
    expect(bridge.has(ctx.session_id, ctx.seat_id)).toBe(false);
  });

  test("detach on unknown handle is a no-op", async () => {
    const { runtime } = fixture();
    await runtime.detach({
      id: "nope",
      seat_id: "x",
      capabilities: new Set(),
    });
  });

  test("attach for two different seats produces distinct handles", async () => {
    const bridge = new UiBridge();
    const runtime = new HumanRuntime(bridge);
    const persona: PersonaSpec = {
      id: "p",
      name: "P",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctxA = {
      session_id: "s1",
      seat_id: "a",
      scenario: "",
      scenario_format: "open" as const,
      cast: [],
      ensemble_mcp_url: "http://x/mcp",
      ensemble_mcp_token: "t",
    };
    const ctxB = { ...ctxA, seat_id: "b" };
    const h1 = await runtime.attach(persona, ctxA);
    const h2 = await runtime.attach(persona, ctxB);
    expect(h1.id).not.toBe(h2.id);
  });
});

describe("HumanRuntime buzzCheck", () => {
  test("always returns the no-buzz response shape, regardless of capability declaration", async () => {
    const { runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);
    const r = await runtime.buzzCheck(handle, []);
    expect(r).toEqual({ score: 0, intent: "", can_pass: true });
  });
});

describe("HumanRuntime takeTurn", () => {
  test("yields chunk text in order, resolves on submit", async () => {
    const { bridge, runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);

    const iter = runtime.takeTurn(handle, []);

    // Find the active turn_id by inspecting the current bridge state — we
    // emit messages via the bridge's HTTP ingest path which only requires
    // the seat+turn match. We can read the focus-event turn_id via SSE,
    // but a simpler path: the runtime uses a deterministic seq.
    // We POST into the bridge by reading the seat's current turn_id.
    // Easiest: drive the iterator and concurrently push messages with the
    // known seq pattern. Expose: assume first turn id = `${handle.id}-turn-1`.
    const turn_id = `${handle.id}-turn-1`;

    // Push messages asynchronously after the iterator starts pulling.
    queueMicrotask(() => {
      bridge.ingest(
        { kind: "chunk", seat_id: ctx.seat_id, turn_id, text: "Hel" },
        ctx.session_id,
      );
      bridge.ingest(
        { kind: "chunk", seat_id: ctx.seat_id, turn_id, text: "lo!" },
        ctx.session_id,
      );
      bridge.ingest(
        { kind: "submit", seat_id: ctx.seat_id, turn_id },
        ctx.session_id,
      );
    });

    const chunks: string[] = [];
    for await (const c of iter) chunks.push(c);
    expect(chunks).toEqual(["Hel", "lo!"]);
  });

  test("resolves on cancel without throwing", async () => {
    const { bridge, runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);
    const iter = runtime.takeTurn(handle, []);
    const turn_id = `${handle.id}-turn-1`;
    queueMicrotask(() => {
      bridge.ingest(
        { kind: "chunk", seat_id: ctx.seat_id, turn_id, text: "x" },
        ctx.session_id,
      );
      bridge.ingest(
        { kind: "cancel", seat_id: ctx.seat_id, turn_id, reason: "abandoned" },
        ctx.session_id,
      );
    });
    const chunks: string[] = [];
    for await (const c of iter) chunks.push(c);
    expect(chunks).toEqual(["x"]);
  });

  test("two consecutive turns each get fresh inputs", async () => {
    const { bridge, runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);

    async function runOne(seq: number, text: string): Promise<string[]> {
      const turn_id = `${handle.id}-turn-${seq}`;
      const iter = runtime.takeTurn(handle, []);
      queueMicrotask(() => {
        bridge.ingest(
          { kind: "chunk", seat_id: ctx.seat_id, turn_id, text },
          ctx.session_id,
        );
        bridge.ingest(
          { kind: "submit", seat_id: ctx.seat_id, turn_id },
          ctx.session_id,
        );
      });
      const out: string[] = [];
      for await (const c of iter) out.push(c);
      return out;
    }

    const r1 = await runOne(1, "first");
    const r2 = await runOne(2, "second");
    expect(r1).toEqual(["first"]);
    expect(r2).toEqual(["second"]);
  });

  test("turnTimeoutMs resolves the turn with whatever has streamed so far", async () => {
    const bridge = new UiBridge();
    const runtime = new HumanRuntime(bridge, { turnTimeoutMs: 25 });
    const persona: PersonaSpec = {
      id: "p",
      name: "P",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctx: SessionContext = {
      session_id: "s1",
      seat_id: "seat-a",
      scenario: "",
      scenario_format: "open",
      cast: [],
      ensemble_mcp_url: "http://x/mcp",
      ensemble_mcp_token: "t",
    };
    const handle = await runtime.attach(persona, ctx);
    const iter = runtime.takeTurn(handle, []);
    const turn_id = `${handle.id}-turn-1`;
    bridge.ingest(
      { kind: "chunk", seat_id: "seat-a", turn_id, text: "partial" },
      "s1",
    );
    const out: string[] = [];
    for await (const c of iter) out.push(c);
    expect(out).toEqual(["partial"]);
  });

  test("emits focus before first chunk and blur after end", async () => {
    const { bridge, runtime, persona, ctx } = fixture();
    const handle = await runtime.attach(persona, ctx);

    // Subscribe to outbound events via SSE route.
    const ssePromise = bridge.routes.request(
      `/events?session_id=${ctx.session_id}&seat_id=${ctx.seat_id}`,
    );

    const iter = runtime.takeTurn(handle, []);
    const turn_id = `${handle.id}-turn-1`;
    queueMicrotask(() => {
      bridge.ingest(
        { kind: "chunk", seat_id: ctx.seat_id, turn_id, text: "hi" },
        ctx.session_id,
      );
      bridge.ingest(
        { kind: "submit", seat_id: ctx.seat_id, turn_id },
        ctx.session_id,
      );
    });
    for await (const _ of iter) {
      /* drain */
    }

    const res = await ssePromise;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    let safety = 0;
    while (safety++ < 20 && (!acc.includes("event: focus") || !acc.includes("event: blur"))) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value);
    }
    await reader.cancel();
    expect(acc).toContain("event: focus");
    expect(acc).toContain("event: blur");
  });
});
