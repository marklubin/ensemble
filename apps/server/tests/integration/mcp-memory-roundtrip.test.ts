import { describe, test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServerForAuth } from "../../src/mcp/server.ts";
import { BuzzCoordinator } from "../../src/mcp/buzz-coordinator.ts";
import { SessionRegistry } from "../../src/mcp/session-registry.ts";
import type { SessionView } from "../../src/mcp/session-registry.ts";
import { InProcessEventBus } from "../../src/mcp/event-bus.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import { SqliteMemoryStore } from "../../src/memory/sqlite-store.ts";
import type { IMemoryStore } from "../../src/memory/store.ts";
import { issue, verify } from "../../src/auth/jwt.ts";

const SECRET = "integration-test-secret-string-32";

interface Wired {
  client: Client;
  memory: IMemoryStore;
  close: () => Promise<void>;
}

async function wire(memory: IMemoryStore): Promise<Wired> {
  const deps = {
    memory,
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
    ],
    round: 1,
    mode: "round-robin",
    cooldownFor: () => 0,
  };
  deps.sessions.register(view);

  const token = issue(
    { session_id: "S", seat_id: "alice", claims: [] },
    SECRET,
  );
  const payload = verify(token, SECRET);
  const server = buildMcpServerForAuth(payload, deps);

  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "c", version: "0" },
    { capabilities: {} },
  );
  await Promise.all([server.connect(st), client.connect(ct)]);

  return {
    client,
    memory,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("L4 — MCP memory round-trip (in-memory backend)", () => {
  test("write({x:42}) then read → 42, persisted in the store", async () => {
    const memory = new MemoryStore();
    const w = await wire(memory);

    const wr = (await w.client.callTool({
      name: "memory.write",
      arguments: { key: "x", value: 42 },
    })) as { isError?: boolean; structuredContent?: unknown };
    expect(wr.isError).not.toBe(true);
    expect(wr.structuredContent).toEqual({ ok: true, key: "x" });

    const rd = (await w.client.callTool({
      name: "memory.read",
      arguments: { key: "x" },
    })) as { isError?: boolean; structuredContent?: unknown };
    expect(rd.isError).not.toBe(true);
    expect(rd.structuredContent).toEqual({ key: "x", value: 42, exists: true });

    // Persisted in the underlying store, namespaced by (session, seat).
    expect(memory.read("S", "alice", "x")).toBe(42);
    await w.close();
  });

  test("complex value round-trips via MCP", async () => {
    const memory = new MemoryStore();
    const w = await wire(memory);
    const payload = {
      goals: ["land the joke", "be specific"],
      score: 0.7,
      tags: { mood: "wry" },
    };
    await w.client.callTool({
      name: "memory.write",
      arguments: { key: "plan", value: payload },
    });
    const rd = (await w.client.callTool({
      name: "memory.read",
      arguments: { key: "plan" },
    })) as { structuredContent?: { value: unknown } };
    expect(rd.structuredContent?.value).toEqual(payload);
    await w.close();
  });

  test("list reports written keys", async () => {
    const memory = new MemoryStore();
    const w = await wire(memory);
    for (const k of ["a", "b", "c"]) {
      await w.client.callTool({
        name: "memory.write",
        arguments: { key: k, value: 1 },
      });
    }
    const ls = (await w.client.callTool({
      name: "memory.list",
      arguments: {},
    })) as { structuredContent?: { keys: string[] } };
    expect((ls.structuredContent?.keys ?? []).sort()).toEqual(["a", "b", "c"]);
    await w.close();
  });
});

describe("L4 — MCP memory round-trip (sqlite backend)", () => {
  test("write then read survives via SqliteMemoryStore", async () => {
    const memory = await SqliteMemoryStore.open(":memory:");
    const w = await wire(memory);
    await w.client.callTool({
      name: "memory.write",
      arguments: { key: "k", value: { yes: true } },
    });
    const rd = (await w.client.callTool({
      name: "memory.read",
      arguments: { key: "k" },
    })) as { structuredContent?: { value: unknown } };
    expect(rd.structuredContent?.value).toEqual({ yes: true });
    expect(memory.read("S", "alice", "k")).toEqual({ yes: true });
    await w.close();
    memory.close();
  });
});
