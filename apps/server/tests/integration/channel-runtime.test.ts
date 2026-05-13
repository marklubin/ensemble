/**
 * L4 integration: boot a tiny Hono server in-process with the
 * channels WS route mounted, open a real WebSocket to it from a
 * "fake bridge", register, drive a turn through `ChannelRuntime`,
 * and assert that the chunks come through.
 *
 * This validates the wiring end-to-end without spawning Claude Code.
 * We use the same Hono `upgradeWebSocket` adapter the real server
 * uses, served by `Bun.serve`. The fake bridge uses the WHATWG
 * `WebSocket` global (Bun ships it).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { ChannelCoordinator } from "../../src/channels/coordinator.ts";
import { createChannelsRoutes } from "../../src/channels/ws-route.ts";
import { ChannelRuntime } from "../../src/runtimes/channel/index.ts";
import type { PersonaSpec, SessionContext } from "@ensemble/shared";
import type {
  BuzzCoordinator,
  BuzzWaiterKey,
  BuzzWaiterResolution,
} from "@ensemble/shared/buzz-coordinator";

// ─── support ─────────────────────────────────────────────────────────

class StubBuzzCoordinator implements BuzzCoordinator {
  private waiters = new Map<string, {
    resolve: (r: BuzzWaiterResolution) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  wait(key: BuzzWaiterKey, timeoutMs: number): Promise<BuzzWaiterResolution> {
    const k = JSON.stringify(key);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(k);
        resolve({ kind: "timeout" });
      }, timeoutMs);
      this.waiters.set(k, { resolve, timer });
    });
  }
  cancel(key: BuzzWaiterKey): void {
    const k = JSON.stringify(key);
    const w = this.waiters.get(k);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(k);
  }
}

function persona(): PersonaSpec {
  return {
    id: "p1",
    name: "Persona One",
    system_prompt: "Be brief.",
    tools_allowed: [],
    memory_policy: "ephemeral",
  };
}

function ctxFor(sessionId: string, seatId: string): SessionContext {
  return {
    session_id: sessionId,
    seat_id: seatId,
    scenario: "test",
    scenario_format: "open",
    cast: [
      { seat_id: seatId, persona_id: "p1", persona_name: "Persona One", runtime_type: "claude-code" },
    ],
    ensemble_mcp_url: "https://example.test/mcp",
    ensemble_mcp_token: "tok",
  };
}

// ─── harness ─────────────────────────────────────────────────────────

interface Harness {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  coordinator: ChannelCoordinator;
  runtime: ChannelRuntime;
  buzz: StubBuzzCoordinator;
}

let harness: Harness;

beforeAll(() => {
  const coordinator = new ChannelCoordinator({ validateToken: () => true });
  const buzz = new StubBuzzCoordinator();
  const runtime = new ChannelRuntime(coordinator, buzz, {
    enabled: true,
    attachConnectWaitMs: 2_000,
    turnTimeoutMs: 5_000,
    buzzCheckTimeoutMs: 2_000,
  });
  const app = new Hono();
  app.route("/channels", createChannelsRoutes(coordinator));
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
  const port = (server.port ?? 0) as number;
  harness = { server, port, coordinator, runtime, buzz };
});

afterAll(() => {
  harness.server.stop();
});

// ─── fake-bridge helper ──────────────────────────────────────────────

/**
 * Open a WebSocket from "outside" the server to the in-process server.
 * Acts as the channel-bridge would. Resolves with a thin handle.
 */
async function openFakeBridge(
  sessionId: string,
  seatId: string,
  port: number,
): Promise<{
  ws: WebSocket;
  send: (msg: object) => void;
  awaitMessage: (predicate: (m: any) => boolean) => Promise<any>;
  receivedAll: () => any[];
  close: () => void;
}> {
  const ws = new WebSocket(`ws://localhost:${port}/channels/ws?token=tok`);
  const received: any[] = [];
  const subs: Array<(m: any) => void> = [];

  ws.addEventListener("message", (evt) => {
    try {
      const msg = JSON.parse(evt.data as string);
      received.push(msg);
      for (const s of [...subs]) s(msg);
    } catch {
      // ignore
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
  });

  const send = (msg: object) => ws.send(JSON.stringify(msg));

  const awaitMessage = (predicate: (m: any) => boolean) =>
    new Promise<any>((resolve) => {
      const existing = received.find(predicate);
      if (existing) return resolve(existing);
      const sub = (m: any) => {
        if (predicate(m)) {
          const idx = subs.indexOf(sub);
          if (idx >= 0) subs.splice(idx, 1);
          resolve(m);
        }
      };
      subs.push(sub);
    });

  send({ type: "register", session_id: sessionId, seat_id: seatId });
  await awaitMessage((m) => m.type === "registered");

  return { ws, send, awaitMessage, receivedAll: () => received, close: () => ws.close() };
}

// ─── tests ───────────────────────────────────────────────────────────

describe("L4: ChannelRuntime over a real WebSocket", () => {
  test("registers and round-trips a turn through the runtime", async () => {
    const sessionId = "S-int-1";
    const seatId = "seat-1";

    const bridge = await openFakeBridge(sessionId, seatId, harness.port);
    expect(harness.coordinator.isConnected(sessionId, seatId)).toBe(true);

    const handle = await harness.runtime.attach(persona(), ctxFor(sessionId, seatId));

    // Drive a turn. As soon as the bridge sees `turn-prompt`, reply with
    // three chunks.
    const turnPromise = (async () => {
      const chunks: string[] = [];
      for await (const c of harness.runtime.takeTurn(handle, [])) chunks.push(c);
      return chunks;
    })();

    const tp = await bridge.awaitMessage((m) => m.type === "turn-prompt");
    bridge.send({ type: "reply", turn_id: tp.turn_id, content: "alpha ", done: false });
    bridge.send({ type: "reply", turn_id: tp.turn_id, content: "beta ", done: false });
    bridge.send({ type: "reply", turn_id: tp.turn_id, content: "gamma", done: true });

    const chunks = await turnPromise;
    expect(chunks.join("")).toBe("alpha beta gamma");

    await harness.runtime.detach(handle);
    bridge.close();
  });

  test("ChannelNotConnectedError before any bridge registers", async () => {
    const handle = await harness.runtime.attach(persona(), ctxFor("S-int-2", "seat-x"));
    // No bridge for seat-x; attach waited and gave up. The first
    // takeTurn surfaces the typed error.
    await expect(async () => {
      for await (const _ of harness.runtime.takeTurn(handle, [])) void _;
    }).toThrow(/No channel connected/);
    await harness.runtime.detach(handle);
  });

  test("disconnect during turn rejects the iterable", async () => {
    const sessionId = "S-int-3";
    const seatId = "seat-3";
    const bridge = await openFakeBridge(sessionId, seatId, harness.port);
    const handle = await harness.runtime.attach(persona(), ctxFor(sessionId, seatId));

    const turn = harness.runtime.takeTurn(handle, []);
    const consumer = (async () => {
      for await (const _ of turn) void _;
    })();

    await bridge.awaitMessage((m) => m.type === "turn-prompt");
    bridge.close();

    await expect(consumer).rejects.toThrow(/disconnected|channel/i);
    await harness.runtime.detach(handle);
  });
});
