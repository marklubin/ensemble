/**
 * L1 unit tests for the ClaudeCodeTransport contract, exercised
 * against MockMcpTransport. Verifies open/send/close shape and the
 * fixture-replay mechanics the SPI conformance suite relies on.
 */

import { describe, expect, test } from "bun:test";
import { MockMcpTransport } from "./mock-transport.ts";
import type { SessionBrief } from "./types.ts";

function makeBrief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return {
    ensemble_session_id: "sess-1",
    seat_id: "seat-A",
    persona: {
      id: "persona-1",
      name: "Test Persona",
      system_prompt: "Be terse.",
      tools_allowed: [],
      memory_policy: "ephemeral",
    },
    scenario: "Discuss a hypothetical.",
    scenario_format: "open",
    cast: [],
    ensemble_mcp_url: "https://example.test/mcp",
    ensemble_mcp_token: "token-xyz",
    ...overrides,
  };
}

describe("MockMcpTransport", () => {
  test("open returns a session id derived from the brief by default", async () => {
    const t = new MockMcpTransport();
    const { session_id } = await t.open(makeBrief());
    expect(session_id).toBe("mock-session-seat-A");
    expect(t.openCount()).toBe(1);
  });

  test("custom openResponse is honored", async () => {
    const t = new MockMcpTransport({
      openResponse: () => ({ session_id: "custom-id" }),
    });
    const { session_id } = await t.open(makeBrief());
    expect(session_id).toBe("custom-id");
  });

  test("send streams chunks for a turn message", async () => {
    const t = new MockMcpTransport({
      turnChunks: function* () {
        yield "hello ";
        yield "world";
      },
    });
    const { session_id } = await t.open(makeBrief());
    const chunks: string[] = [];
    for await (const c of t.send(session_id, {
      kind: "turn",
      prompt: "say hi",
      events: [],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["hello ", "world"]);
  });

  test("send for buzz_check fires onBuzzCheck hook and yields fixture chunks", async () => {
    let hookCalled = false;
    let seenNonce = "";
    const t = new MockMcpTransport({
      onBuzzCheck: (_brief, msg) => {
        hookCalled = true;
        seenNonce = msg.nonce;
      },
      buzzChunks: function* () {
        yield "ack";
      },
    });
    const { session_id } = await t.open(makeBrief());
    const out: string[] = [];
    for await (const c of t.send(session_id, {
      kind: "buzz_check",
      prompt: "do you want to speak?",
      nonce: "n-abcdefgh",
      recentTurns: [],
    })) {
      out.push(c);
    }
    // Hook is fire-and-forget; flush microtasks just in case.
    await Promise.resolve();
    expect(hookCalled).toBe(true);
    expect(seenNonce).toBe("n-abcdefgh");
    expect(out).toEqual(["ack"]);
  });

  test("send on unknown session id throws", async () => {
    const t = new MockMcpTransport();
    await expect(async () => {
      for await (const _ of t.send("bogus", {
        kind: "turn",
        prompt: "",
        events: [],
      })) {
        // unreachable
      }
    }).toThrow(/unknown session/);
  });

  test("close drops the session", async () => {
    const t = new MockMcpTransport();
    const { session_id } = await t.open(makeBrief());
    expect(t.openCount()).toBe(1);
    await t.close(session_id);
    expect(t.openCount()).toBe(0);
    // Subsequent sends should fail.
    await expect(async () => {
      for await (const _ of t.send(session_id, {
        kind: "turn",
        prompt: "",
        events: [],
      })) {
        // unreachable
      }
    }).toThrow(/unknown session/);
  });
});
