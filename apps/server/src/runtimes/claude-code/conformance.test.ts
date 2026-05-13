/**
 * L2 SPI conformance — runs the shared `runConformanceSuite` against
 * `ClaudeCodeRuntime` wired to `MockMcpTransport`.
 *
 * Agent A owns the actual conformance cases. If they haven't filled
 * them in yet, the suite is a no-op (Phase 0 stub) — this test still
 * passes, which is the explicitly-documented "skeleton-passes"
 * acceptance state. We add a handful of local L1-ish runtime tests
 * below so the runtime's own contract has coverage regardless.
 */

import { describe, expect, test } from "bun:test";
import { runConformanceSuite } from "@ensemble/spi-conformance";

import { ClaudeCodeRuntime } from "./index.ts";
import { MockMcpTransport, type MockTransportFixture } from "./mock-transport.ts";
import type { SessionContext } from "@ensemble/shared/session";
import type { PersonaSpec } from "@ensemble/shared/persona";
import type {
  BuzzCoordinator,
  BuzzWaiterKey,
  BuzzWaiterResolution,
} from "@ensemble/shared/buzz-coordinator";

// ─── Test doubles ─────────────────────────────────────────────────────

/**
 * Minimal in-memory BuzzCoordinator stub. Real implementation lives in
 * the MCP server package (Agent B). This stub is fine for fixture
 * tests because the mock transport fires `onBuzzCheck` synchronously
 * and we resolve from there.
 */
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

  /** Test helper: resolve a pending waiter as if the agent had pressed/passed. */
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

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    session_id: "sess-conformance",
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

function makeFixture(): MockTransportFixture {
  return {
    turnChunks: function* (_brief, message) {
      yield `chunk1:`;
      yield message.prompt.slice(0, 32);
    },
  };
}

// ─── Conformance entry point ──────────────────────────────────────────

runConformanceSuite("claude-code", async () => {
  const transport = new MockMcpTransport(makeFixture());
  const buzz = new StubBuzzCoordinator();
  const runtime = new ClaudeCodeRuntime(transport, buzz, {
    enabled: true,
    buzzCheckTimeoutMs: 500,
  });
  return { runtime, fixtureMode: true };
});

// ─── Local runtime contract tests (independent of Agent A's suite) ────

describe("ClaudeCodeRuntime", () => {
  test("name and default capabilities", () => {
    const runtime = new ClaudeCodeRuntime(
      new MockMcpTransport(),
      new StubBuzzCoordinator(),
      { enabled: true },
    );
    expect(runtime.name).toBe("claude-code");
    expect(runtime.defaultCapabilities.has("streaming")).toBe(true);
    expect(runtime.defaultCapabilities.has("buzz_check")).toBe(true);
    expect(runtime.defaultCapabilities.has("tools")).toBe(true);
    expect(runtime.defaultCapabilities.has("mcp")).toBe(true);
  });

  test("attach throws RuntimeDisabledError when flag is off", async () => {
    const runtime = new ClaudeCodeRuntime(
      new MockMcpTransport(),
      new StubBuzzCoordinator(),
      { enabled: false },
    );
    await expect(runtime.attach(makePersona(), makeContext())).rejects.toThrow(
      /not configured/,
    );
  });

  test("attach hands a session id back as the InstanceHandle id", async () => {
    const transport = new MockMcpTransport({
      openResponse: () => ({ session_id: "S-1" }),
    });
    const runtime = new ClaudeCodeRuntime(transport, new StubBuzzCoordinator(), {
      enabled: true,
    });
    const handle = await runtime.attach(makePersona(), makeContext());
    expect(handle.id).toBe("S-1");
    expect(handle.seat_id).toBe("seat-1");
    expect(handle.capabilities.has("streaming")).toBe(true);
  });

  test("takeTurn streams chunks from the transport", async () => {
    const transport = new MockMcpTransport({
      turnChunks: function* () {
        yield "a";
        yield "b";
        yield "c";
      },
    });
    const runtime = new ClaudeCodeRuntime(transport, new StubBuzzCoordinator(), {
      enabled: true,
    });
    const handle = await runtime.attach(makePersona(), makeContext());
    const chunks: string[] = [];
    for await (const c of runtime.takeTurn(handle, [])) chunks.push(c);
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  test("buzzCheck resolves when the BuzzCoordinator is pressed", async () => {
    const buzz = new StubBuzzCoordinator();
    const transport = new MockMcpTransport({
      onBuzzCheck: (_brief, msg) => {
        // Simulate the agent calling buzzer.press via MCP.
        buzz.resolveByNonce(msg.nonce, {
          kind: "pressed",
          score: 7,
          intent: "I have a point",
        });
      },
    });
    const runtime = new ClaudeCodeRuntime(transport, buzz, {
      enabled: true,
      buzzCheckTimeoutMs: 500,
    });
    const handle = await runtime.attach(makePersona(), makeContext());
    const result = await runtime.buzzCheck(handle, []);
    expect(result.score).toBe(7);
    expect(result.intent).toBe("I have a point");
    expect(result.can_pass).toBe(true);
  });

  test("buzzCheck resolves when the agent passes", async () => {
    const buzz = new StubBuzzCoordinator();
    const transport = new MockMcpTransport({
      onBuzzCheck: (_brief, msg) => {
        buzz.resolveByNonce(msg.nonce, { kind: "passed", reason: "no comment" });
      },
    });
    const runtime = new ClaudeCodeRuntime(transport, buzz, {
      enabled: true,
      buzzCheckTimeoutMs: 500,
    });
    const handle = await runtime.attach(makePersona(), makeContext());
    const result = await runtime.buzzCheck(handle, []);
    expect(result.score).toBe(0);
    expect(result.intent).toBe("no comment");
    expect(result.can_pass).toBe(true);
  });

  test("buzzCheck returns a zero-score pass on timeout", async () => {
    const buzz = new StubBuzzCoordinator();
    const transport = new MockMcpTransport({
      // No onBuzzCheck — the waiter will time out.
    });
    const runtime = new ClaudeCodeRuntime(transport, buzz, {
      enabled: true,
      buzzCheckTimeoutMs: 50,
    });
    const handle = await runtime.attach(makePersona(), makeContext());
    const result = await runtime.buzzCheck(handle, []);
    expect(result.score).toBe(0);
    expect(result.intent).toBe("");
    expect(result.can_pass).toBe(true);
  });

  test("detach closes the transport session and is idempotent", async () => {
    const transport = new MockMcpTransport();
    const runtime = new ClaudeCodeRuntime(transport, new StubBuzzCoordinator(), {
      enabled: true,
    });
    const handle = await runtime.attach(makePersona(), makeContext());
    expect(transport.openCount()).toBe(1);
    await runtime.detach(handle);
    expect(transport.openCount()).toBe(0);
    // Second detach must not throw.
    await runtime.detach(handle);
    expect(transport.openCount()).toBe(0);
  });

  test("takeTurn on a stale handle surfaces a clear error", async () => {
    const runtime = new ClaudeCodeRuntime(
      new MockMcpTransport(),
      new StubBuzzCoordinator(),
      { enabled: true },
    );
    const fakeHandle = {
      id: "never-attached",
      seat_id: "seat-x",
      capabilities: runtime.defaultCapabilities,
    };
    await expect(async () => {
      for await (const _ of runtime.takeTurn(fakeHandle, [])) {
        // unreachable
      }
    }).toThrow(/unknown handle/);
  });
});
