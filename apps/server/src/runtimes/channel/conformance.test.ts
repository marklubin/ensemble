/**
 * L2 SPI conformance for ChannelRuntime + L1 runtime contract tests.
 *
 * Uses an in-process MockChannel that fulfills `ChannelConnection`
 * directly (no real WS) so the suite runs without sockets. The
 * MockChannel echoes turn-prompts back as scripted replies, and
 * fires `buzzer.press`/`buzzer.pass` resolutions for buzz checks.
 */

import { describe, expect, test } from "bun:test";
import { runConformanceSuite } from "@ensemble/spi-conformance";

import {
  ChannelCoordinator,
  type ChannelConnection,
} from "../../channels/coordinator.ts";
import { ChannelRuntime } from "./index.ts";
import type { SessionContext } from "@ensemble/shared/session";
import type { PersonaSpec } from "@ensemble/shared/persona";
import type {
  BuzzCoordinator,
  BuzzWaiterKey,
  BuzzWaiterResolution,
} from "@ensemble/shared/buzz-coordinator";

// ─── Stub coordinator + connection ────────────────────────────────────

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
  resolveByNonce(nonce: string, resolution: BuzzWaiterResolution): boolean {
    for (const [k, w] of this.waiters.entries()) {
      const key = JSON.parse(k) as BuzzWaiterKey;
      if (key.nonce === nonce) {
        clearTimeout(w.timer);
        this.waiters.delete(k);
        w.resolve(resolution);
        return true;
      }
    }
    return false;
  }
}

interface MockChannelOptions {
  /** Reply scripted per turn message. Default: a single "ok" chunk. */
  scriptTurnReply?: (prompt: string, meta: Record<string, unknown>) => Array<{ content: string; done?: boolean }>;
  /** Side-channel hook invoked on every turn-prompt (used to resolve buzz waiters). */
  onTurnPrompt?: (msg: { turn_id: string; prompt: string; meta: Record<string, unknown> }) => void;
}

class MockChannelConnection implements ChannelConnection {
  private msgHandler: ((p: string) => void) | null = null;
  private closeHandler: ((info: { code?: number; reason?: string }) => void) | null = null;
  public closed = false;

  constructor(private readonly opts: MockChannelOptions = {}) {}

  send(payload: string): void {
    if (this.closed) return;
    let msg: any;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg.type !== "turn-prompt") return;

    this.opts.onTurnPrompt?.(msg);

    // Schedule scripted replies on next tick.
    const replies = (this.opts.scriptTurnReply
      ? this.opts.scriptTurnReply(msg.prompt, msg.meta ?? {})
      : [{ content: "ok", done: true }]);

    queueMicrotask(() => {
      for (let i = 0; i < replies.length; i++) {
        const r = replies[i]!;
        const isLast = i === replies.length - 1;
        const done = r.done ?? isLast;
        this.msgHandler?.(
          JSON.stringify({
            type: "reply",
            turn_id: msg.turn_id,
            content: r.content,
            done,
          }),
        );
        if (done) break;
      }
    });
  }
  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.({ code, reason });
  }
  onMessage(h: (p: string) => void): void {
    this.msgHandler = h;
  }
  onClose(h: (info: { code?: number; reason?: string }) => void): void {
    this.closeHandler = h;
  }
  // Send register frame immediately so the coordinator binds us.
  register(sessionId: string, seatId: string): void {
    this.msgHandler?.(
      JSON.stringify({ type: "register", session_id: sessionId, seat_id: seatId }),
    );
  }
}

/** Helper: build a coordinator + register a connection for every attach. */
function wireFactoryConnection(
  coordinator: ChannelCoordinator,
  buzz: StubBuzzCoordinator,
): void {
  // The conformance suite uses session ids "s-test" (default) and seat
  // ids like "seat-1", "seat-2", etc. We intercept by hooking
  // ChannelRuntime.attach via a wrapper that's installed below.
  void coordinator;
  void buzz;
}

// ─── Conformance entry point ──────────────────────────────────────────

runConformanceSuite("claude-code-channel", async () => {
  const coordinator = new ChannelCoordinator({ validateToken: () => true });
  const buzz = new StubBuzzCoordinator();

  // We need each `attach` to result in a registered channel. The
  // suite calls `runtime.attach(...)` with seat ids it picks. We
  // shim `attach` to pre-register a fresh MockChannelConnection.
  const runtime = new ChannelRuntime(coordinator, buzz, {
    enabled: true,
    attachConnectWaitMs: 0, // tests don't wait
    turnTimeoutMs: 2_000,
    buzzCheckTimeoutMs: 500,
  });

  const realAttach = runtime.attach.bind(runtime);
  runtime.attach = async (persona, ctx) => {
    // Register a mock connection for this (session, seat) before
    // delegating, so subsequent dispatches succeed.
    const conn = new MockChannelConnection({
      onTurnPrompt: (msg) => {
        // If this is a buzz_check prompt, resolve the waiter via the
        // BuzzCoordinator using the nonce in the meta.
        const meta = msg.meta as { kind?: string; nonce?: string };
        if (meta.kind === "buzz_check" && meta.nonce) {
          // Pressed by default to satisfy "valid BuzzResponse" cases.
          buzz.resolveByNonce(meta.nonce, {
            kind: "pressed",
            score: 5,
            intent: "ack from MockChannel",
          });
        }
      },
    });
    coordinator.acceptConnection(conn, "tok");
    conn.register(ctx.session_id, ctx.seat_id);
    return realAttach(persona, ctx);
  };

  wireFactoryConnection(coordinator, buzz);

  return {
    runtime,
    fixtureMode: true,
    teardown: async () => {
      // close every still-open seat
      // (the coordinator.unregister flow is exercised by detach)
    },
  };
});

// ─── Local runtime contract tests ─────────────────────────────────────

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    session_id: "sess-ch",
    seat_id: "seat-1",
    scenario: "test",
    scenario_format: "open",
    cast: [
      {
        seat_id: "seat-1",
        persona_id: "p1",
        persona_name: "Persona One",
        runtime_type: "claude-code",
      },
    ],
    ensemble_mcp_url: "https://example.test/mcp",
    ensemble_mcp_token: "token",
    ...overrides,
  };
}

function makePersona(): PersonaSpec {
  return {
    id: "p1",
    name: "Persona One",
    system_prompt: "Be brief.",
    tools_allowed: [],
    memory_policy: "ephemeral",
  };
}

describe("ChannelRuntime", () => {
  test("name and default capabilities", () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const b = new StubBuzzCoordinator();
    const r = new ChannelRuntime(c, b, { enabled: true });
    expect(r.name).toBe("claude-code");
    expect(r.defaultCapabilities.has("streaming")).toBe(true);
    expect(r.defaultCapabilities.has("buzz_check")).toBe(true);
    expect(r.defaultCapabilities.has("tools")).toBe(true);
    expect(r.defaultCapabilities.has("mcp")).toBe(true);
  });

  test("attach throws when disabled", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const b = new StubBuzzCoordinator();
    const r = new ChannelRuntime(c, b, { enabled: false });
    await expect(r.attach(makePersona(), makeContext())).rejects.toThrow(/not configured/);
  });

  test("takeTurn throws ChannelNotConnectedError when no bridge is attached", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const b = new StubBuzzCoordinator();
    const r = new ChannelRuntime(c, b, { enabled: true, attachConnectWaitMs: 0 });
    const h = await r.attach(makePersona(), makeContext());
    await expect(async () => {
      for await (const _ of r.takeTurn(h, [])) void _;
    }).toThrow(/No channel connected/);
  });

  test("takeTurn streams chunks from the bridge", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const b = new StubBuzzCoordinator();
    const r = new ChannelRuntime(c, b, {
      enabled: true,
      attachConnectWaitMs: 0,
      turnTimeoutMs: 1000,
    });

    const conn = new MockChannelConnection({
      scriptTurnReply: () => [
        { content: "hello" },
        { content: " " },
        { content: "world" },
      ],
    });
    c.acceptConnection(conn, "tok");
    conn.register("sess-ch", "seat-1");

    const h = await r.attach(makePersona(), makeContext());
    const chunks: string[] = [];
    for await (const ch of r.takeTurn(h, [])) chunks.push(ch);
    expect(chunks.join("")).toBe("hello world");
  });

  test("buzzCheck resolves when the BuzzCoordinator is pressed", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const b = new StubBuzzCoordinator();
    const r = new ChannelRuntime(c, b, {
      enabled: true,
      attachConnectWaitMs: 0,
      buzzCheckTimeoutMs: 500,
    });
    const conn = new MockChannelConnection({
      onTurnPrompt: (msg) => {
        const meta = msg.meta as { kind?: string; nonce?: string };
        if (meta.kind === "buzz_check" && meta.nonce) {
          b.resolveByNonce(meta.nonce, {
            kind: "pressed",
            score: 8,
            intent: "I have a point",
          });
        }
      },
    });
    c.acceptConnection(conn, "tok");
    conn.register("sess-ch", "seat-1");

    const h = await r.attach(makePersona(), makeContext());
    const res = await r.buzzCheck(h, []);
    expect(res.score).toBe(8);
    expect(res.intent).toBe("I have a point");
    expect(res.can_pass).toBe(true);
  });

  test("detach unregisters the channel", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const b = new StubBuzzCoordinator();
    const r = new ChannelRuntime(c, b, { enabled: true, attachConnectWaitMs: 0 });
    const conn = new MockChannelConnection();
    c.acceptConnection(conn, "tok");
    conn.register("sess-ch", "seat-1");
    const h = await r.attach(makePersona(), makeContext());
    expect(c.isConnected("sess-ch", "seat-1")).toBe(true);
    await r.detach(h);
    expect(c.isConnected("sess-ch", "seat-1")).toBe(false);
  });
});
