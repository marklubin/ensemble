import { describe, test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServerForAuth } from "../../src/mcp/server.ts";
import { BuzzCoordinator } from "../../src/mcp/buzz-coordinator.ts";
import { SessionRegistry } from "../../src/mcp/session-registry.ts";
import type { SessionView } from "../../src/mcp/session-registry.ts";
import { InProcessEventBus } from "../../src/mcp/event-bus.ts";
import type { BusEvent } from "../../src/mcp/event-bus.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import { issue, verify } from "../../src/auth/jwt.ts";

/**
 * L4 — two MCP clients (one moderator-claimed, one not) share a
 * single in-memory deps bundle. The privileged call from the
 * non-moderator must fail FORBIDDEN with no side-effects. The
 * same call from the moderator must publish an event to the bus.
 *
 * This integration test wires the JWT issue/verify path end-to-end,
 * which the unit tests don't cover together.
 */

const SECRET = "integration-test-secret-string-32";

interface Wired {
  modClient: Client;
  castClient: Client;
  bus: InProcessEventBus;
  events: BusEvent[];
  close: () => Promise<void>;
}

async function wireTwoClients(): Promise<Wired> {
  // Shared deps so we can assert side-effects globally.
  const deps = {
    memory: new MemoryStore(),
    buzz: new BuzzCoordinator(),
    sessions: new SessionRegistry(),
    bus: new InProcessEventBus(),
  };
  const view: SessionView = {
    session_id: "S",
    cast: [
      {
        seat_id: "alice",
        persona_id: "p1",
        persona_name: "Alice",
        runtime_type: "managed-agents",
      },
      {
        seat_id: "mod",
        persona_id: "p2",
        persona_name: "Mod",
        runtime_type: "managed-agents",
      },
    ],
    round: 1,
    mode: "round-robin",
    cooldownFor: () => 0,
  };
  deps.sessions.register(view);

  const events: BusEvent[] = [];
  deps.bus.subscribe((e) => {
    events.push(e);
  });

  // Issue real JWTs; verify them; build per-token servers (mirrors HTTP).
  const castToken = issue(
    { session_id: "S", seat_id: "alice", claims: [] },
    SECRET,
  );
  const modToken = issue(
    { session_id: "S", seat_id: "mod", claims: ["moderator"] },
    SECRET,
  );
  const castPayload = verify(castToken, SECRET);
  const modPayload = verify(modToken, SECRET);

  const castServer = buildMcpServerForAuth(castPayload, deps);
  const modServer = buildMcpServerForAuth(modPayload, deps);

  const [castCT, castST] = InMemoryTransport.createLinkedPair();
  const [modCT, modST] = InMemoryTransport.createLinkedPair();

  const castClient = new Client(
    { name: "cast", version: "0" },
    { capabilities: {} },
  );
  const modClient = new Client(
    { name: "mod", version: "0" },
    { capabilities: {} },
  );

  await Promise.all([
    castServer.connect(castST),
    castClient.connect(castCT),
    modServer.connect(modST),
    modClient.connect(modCT),
  ]);

  return {
    modClient,
    castClient,
    bus: deps.bus,
    events,
    close: async () => {
      await castClient.close();
      await modClient.close();
      await castServer.close();
      await modServer.close();
    },
  };
}

describe("L4 — moderator privilege gate", () => {
  test("non-moderator force_speaker is FORBIDDEN, no event published", async () => {
    const w = await wireTwoClients();
    const r = (await w.castClient.callTool({
      name: "moderator.force_speaker",
      arguments: { seat_id: "alice" },
    })) as { isError?: boolean; structuredContent?: { error?: string } };
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.error).toBe("FORBIDDEN");
    expect(w.events.length).toBe(0); // no side-effect

    // And the same call from the moderator succeeds.
    const ok = (await w.modClient.callTool({
      name: "moderator.force_speaker",
      arguments: { seat_id: "alice" },
    })) as { isError?: boolean; structuredContent?: unknown };
    expect(ok.isError).not.toBe(true);
    expect(ok.structuredContent).toEqual({ ok: true });
    expect(w.events.length).toBe(1);
    expect(w.events[0]?.type).toBe("moderator");
    if (w.events[0]?.type === "moderator") {
      expect(w.events[0].payload.kind).toBe("force_speaker");
      expect(w.events[0].payload.target_seat_id).toBe("alice");
      expect(w.events[0].payload.issuer_seat_id).toBe("mod");
    }
    await w.close();
  });

  test("all four moderator tools enforce the claim", async () => {
    const w = await wireTwoClients();
    const calls = [
      { name: "moderator.force_speaker", arguments: { seat_id: "alice" } },
      {
        name: "moderator.cooldown",
        arguments: { seat_id: "alice", rounds: 1, reason: "r" },
      },
      {
        name: "moderator.bypass",
        arguments: { seat_id: "alice", reason: "r" },
      },
      { name: "moderator.inject", arguments: {} },
    ];
    for (const c of calls) {
      const r = (await w.castClient.callTool(c)) as {
        isError?: boolean;
        structuredContent?: { error?: string };
      };
      expect(r.isError).toBe(true);
      expect(r.structuredContent?.error).toBe("FORBIDDEN");
    }
    expect(w.events.length).toBe(0);
    await w.close();
  });
});
