import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildMcpServerForAuth } from "./server.ts";
import { BuzzCoordinator } from "./buzz-coordinator.ts";
import { SessionRegistry } from "./session-registry.ts";
import type { SessionView } from "./session-registry.ts";
import { InProcessEventBus } from "./event-bus.ts";
import type { BusEvent } from "./event-bus.ts";
import { MemoryStore } from "../memory/store.ts";
import type { TokenPayload } from "../auth/jwt.ts";

/**
 * L3 contract tests for the Host API MCP tools.
 *
 * Strategy:
 *   - Spin up an `McpServer` for a given auth payload.
 *   - Pair it with a `Client` via linked InMemoryTransport.
 *   - Issue `tools/call` and assert the structured response shape.
 *   - For moderator tools, also issue with a non-moderator token and
 *     assert isError + FORBIDDEN code (server-side gate).
 *   - For inputs that fail validation (e.g. seat_id missing), assert
 *     isError + INVALID_INPUT.
 *
 * One harness, eleven tools, all the FORBIDDEN cases.
 */

interface Harness {
  client: Client;
  closeable: { server: McpServer };
  deps: {
    memory: MemoryStore;
    buzz: BuzzCoordinator;
    sessions: SessionRegistry;
    bus: InProcessEventBus;
  };
  capturedBusEvents: BusEvent[];
}

async function setupHarness(auth: TokenPayload): Promise<Harness> {
  const deps = {
    memory: new MemoryStore(),
    buzz: new BuzzCoordinator(),
    sessions: new SessionRegistry(),
    bus: new InProcessEventBus(),
  };
  // Register a session view for the auth so cast/round tools resolve.
  const view: SessionView = {
    session_id: auth.session_id,
    cast: [
      {
        seat_id: auth.seat_id,
        persona_id: "p-alice",
        persona_name: "Alice",
        role: "participant",
        runtime_type: "managed-agents",
      },
      {
        seat_id: "bob",
        persona_id: "p-bob",
        persona_name: "Bob",
        role: "participant",
        runtime_type: "managed-agents",
      },
    ],
    round: 3,
    mode: "round-robin",
    cooldownFor: (seatId) => (seatId === "bob" ? 2 : 0),
  };
  deps.sessions.register(view);

  const capturedBusEvents: BusEvent[] = [];
  deps.bus.subscribe((ev) => {
    capturedBusEvents.push(ev);
  });

  const server = buildMcpServerForAuth(auth, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    client,
    closeable: { server },
    deps,
    capturedBusEvents,
  };
}

async function teardown(h: Harness) {
  await h.client.close();
  await h.closeable.server.close();
}

interface ToolCallResultSnapshot {
  isError: boolean;
  structured: unknown;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResultSnapshot> {
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as { isError?: boolean; structuredContent?: unknown };
  return {
    isError: result.isError === true,
    structured: result.structuredContent,
  };
}

// ─── Tokens ─────────────────────────────────────────────────────────

const ALICE_AUTH: TokenPayload = {
  session_id: "s1",
  seat_id: "alice",
  claims: [],
  iat: 0,
};
const MOD_AUTH: TokenPayload = {
  session_id: "s1",
  seat_id: "mod",
  claims: ["moderator"],
  iat: 0,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("MCP contract — tools/list", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness(ALICE_AUTH);
  });
  afterAll(async () => teardown(h));

  test("lists all 11 Host API tools", async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "buzzer.press",
        "buzzer.pass",
        "memory.read",
        "memory.write",
        "memory.list",
        "cast.list",
        "round.info",
        "moderator.force_speaker",
        "moderator.cooldown",
        "moderator.bypass",
        "moderator.inject",
      ].sort(),
    );
  });
});

describe("MCP contract — buzzer.*", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness(ALICE_AUTH);
  });
  afterAll(async () => teardown(h));

  test("buzzer.press happy path (no nonce → resolved=false)", async () => {
    const r = await call(h.client, "buzzer.press", {
      intensity: 5,
      intent: "I have a point",
    });
    expect(r.isError).toBe(false);
    expect(r.structured).toEqual({ ok: true, resolved: false });
  });

  test("buzzer.press with nonce embedded in intent resolves a waiter", async () => {
    // The MCP SDK strips unknown args via the input Zod schema. The
    // brief calls out two transports for the nonce — explicit field
    // (Zod-extended in a follow-up) or `#nonce:XXX` suffix in `intent`.
    // We test the suffix form here (works without modifying shared).
    const key = {
      session_id: ALICE_AUTH.session_id,
      seat_id: ALICE_AUTH.seat_id,
      nonce: "nonceZZZZ",
    };
    const pending = h.deps.buzz.wait(key, 2000);
    const r = await call(h.client, "buzzer.press", {
      intensity: 8,
      intent: "go #nonce:nonceZZZZ",
    });
    expect(r.isError).toBe(false);
    expect(r.structured).toEqual({ ok: true, resolved: true });
    const resolved = await pending;
    expect(resolved).toEqual({
      kind: "pressed",
      score: 8,
      intent: "go #nonce:nonceZZZZ",
    });
  });

  test("buzzer.pass happy path", async () => {
    const r = await call(h.client, "buzzer.pass", { reason: "nothing" });
    expect(r.isError).toBe(false);
    expect(r.structured).toEqual({ ok: true, resolved: false });
  });

  test("buzzer.press with invalid intensity is rejected by SDK", async () => {
    // SDK validates inputs against the registered schema and returns
    // `{isError:true, content:[<text>]}`. No structured envelope.
    const r = (await h.client.callTool({
      name: "buzzer.press",
      arguments: { intensity: 99, intent: "x" },
    })) as { isError?: boolean; content?: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text ?? "").toMatch(/Invalid arguments/);
  });
});

describe("MCP contract — memory.*", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness(ALICE_AUTH);
  });
  afterAll(async () => teardown(h));

  test("memory.write then memory.read round-trips", async () => {
    const w = await call(h.client, "memory.write", { key: "k1", value: 42 });
    expect(w.isError).toBe(false);
    expect(w.structured).toEqual({ ok: true, key: "k1" });

    const r = await call(h.client, "memory.read", { key: "k1" });
    expect(r.isError).toBe(false);
    expect(r.structured).toEqual({ key: "k1", value: 42, exists: true });
  });

  test("memory.read of missing key reports exists:false", async () => {
    const r = await call(h.client, "memory.read", { key: "ghost" });
    expect(r.isError).toBe(false);
    expect((r.structured as { exists: boolean }).exists).toBe(false);
  });

  test("memory.list reflects writes", async () => {
    await call(h.client, "memory.write", { key: "a", value: 1 });
    await call(h.client, "memory.write", { key: "b", value: 2 });
    const r = await call(h.client, "memory.list", {});
    expect(r.isError).toBe(false);
    const keys = (r.structured as { keys: string[] }).keys.sort();
    expect(keys).toEqual(expect.arrayContaining(["a", "b"]));
  });

  test("memory writes do not leak to other seats", async () => {
    await call(h.client, "memory.write", { key: "secret", value: "alice" });
    // Direct store check using a different seat id — the cross-seat
    // isolation property the auth enforces.
    expect(h.deps.memory.read("s1", "alice", "secret")).toBe("alice");
    expect(h.deps.memory.read("s1", "bob", "secret")).toBeUndefined();
  });

  test("memory.write with missing key is rejected by SDK", async () => {
    const r = (await h.client.callTool({
      name: "memory.write",
      arguments: { value: 1 },
    })) as { isError?: boolean; content?: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text ?? "").toMatch(/Invalid arguments/);
  });
});

describe("MCP contract — cast.list / round.info", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness(ALICE_AUTH);
  });
  afterAll(async () => teardown(h));

  test("cast.list returns the registered cast", async () => {
    const r = await call(h.client, "cast.list", {});
    expect(r.isError).toBe(false);
    const cast = (r.structured as { cast: Array<{ seat_id: string }> }).cast;
    expect(cast.map((c) => c.seat_id).sort()).toEqual(["alice", "bob"]);
  });

  test("round.info reports round + cooldown_remaining", async () => {
    const r = await call(h.client, "round.info", {});
    expect(r.isError).toBe(false);
    expect(r.structured).toEqual({
      round: 3,
      mode: "round-robin",
      cooldown_remaining: 0, // alice has 0
    });
  });
});

describe("MCP contract — moderator.* gating", () => {
  let castSeat: Harness;
  let moderator: Harness;
  beforeAll(async () => {
    castSeat = await setupHarness(ALICE_AUTH);
    moderator = await setupHarness(MOD_AUTH);
  });
  afterAll(async () => {
    await teardown(castSeat);
    await teardown(moderator);
  });

  // Run each moderator tool: cast seat → FORBIDDEN; moderator → OK.
  const moderatorCases: Array<{ tool: string; args: Record<string, unknown> }> =
    [
      { tool: "moderator.force_speaker", args: { seat_id: "bob" } },
      {
        tool: "moderator.cooldown",
        args: { seat_id: "bob", rounds: 2, reason: "talking over" },
      },
      {
        tool: "moderator.bypass",
        args: { seat_id: "bob", reason: "skip this round" },
      },
      { tool: "moderator.inject", args: {} },
    ];

  for (const c of moderatorCases) {
    test(`${c.tool} — non-moderator token gets FORBIDDEN`, async () => {
      const r = await call(castSeat.client, c.tool, c.args);
      expect(r.isError).toBe(true);
      const body = r.structured as { error?: string };
      expect(body.error).toBe("FORBIDDEN");
      // Negative side-effect: no bus event was published.
      expect(
        castSeat.capturedBusEvents.find(
          (e) =>
            e.type === "moderator" &&
            e.payload.issuer_seat_id === ALICE_AUTH.seat_id,
        ),
      ).toBeUndefined();
    });

    test(`${c.tool} — moderator token succeeds`, async () => {
      const r = await call(moderator.client, c.tool, c.args);
      expect(r.isError).toBe(false);
      expect(r.structured).toEqual({ ok: true });
      // Positive side-effect: an event of the right kind was published.
      const kind = c.tool.split(".")[1] as
        | "force_speaker"
        | "cooldown"
        | "bypass"
        | "inject";
      const matching = moderator.capturedBusEvents.find(
        (e) => e.type === "moderator" && e.payload.kind === kind,
      );
      expect(matching).toBeDefined();
    });
  }

  test("moderator.cooldown with missing rounds is rejected", async () => {
    // SDK input-schema validation kicks in before our handler;
    // surfaces as `isError:true` with a text message.
    const r = (await moderator.client.callTool({
      name: "moderator.cooldown",
      arguments: { seat_id: "bob", reason: "x" },
    })) as { isError?: boolean; content?: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text ?? "").toMatch(/Invalid arguments|rounds/);
  });
});
