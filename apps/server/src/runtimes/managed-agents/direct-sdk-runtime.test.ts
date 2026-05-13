import { describe, test, expect } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  PersonaSpec,
  SessionContext,
  TurnEvent,
  BuzzCoordinator,
  BuzzWaiterKey,
  BuzzWaiterResolution,
} from "@ensemble/shared";
import { DirectSdkRuntime } from "./direct-sdk-runtime.ts";
import {
  FakeAnthropic,
  textStreamEvents,
  toolUseStreamEvents,
} from "./test-helpers/fake-anthropic.ts";

const PERSONA: PersonaSpec = {
  id: "p1",
  name: "Ada",
  system_prompt: "You are Ada.",
  tools_allowed: ["buzzer.press", "buzzer.pass"],
  memory_policy: "ephemeral",
};

const CTX = (seat: string): SessionContext => ({
  session_id: "sess1",
  seat_id: seat,
  scenario: "Test scenario",
  scenario_format: "motion",
  cast: [],
  ensemble_mcp_url: "https://mcp.test/ensemble",
  ensemble_mcp_token: "tok",
});

function makeRuntime(fake: FakeAnthropic, coord?: BuzzCoordinator) {
  return new DirectSdkRuntime(fake as unknown as Anthropic, "model-test", coord);
}

const TURN: TurnEvent = {
  kind: "turn",
  seat_id: "other",
  speaker: "Other",
  content: "Opening statement.",
  round: 1,
  timestamp: "2026-05-12T10:00:00.000Z",
};

describe("DirectSdkRuntime lifecycle", () => {
  test("attach returns a handle with the runtime's default capabilities", async () => {
    const fake = new FakeAnthropic({});
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    expect(handle.seat_id).toBe("s1");
    expect(handle.id).toBeTruthy();
    expect(handle.capabilities.has("streaming")).toBe(true);
    expect(handle.capabilities.has("buzz_check")).toBe(true);
    expect(handle.capabilities.has("tools")).toBe(true);
  });

  test("detach is idempotent (calling twice does not throw)", async () => {
    const rt = makeRuntime(new FakeAnthropic({}));
    const handle = await rt.attach(PERSONA, CTX("s1"));
    await rt.detach(handle);
    await rt.detach(handle); // should not throw
    expect(rt.activeSessions()).toHaveLength(0);
  });

  test("takeTurn on unknown handle throws a typed error", async () => {
    const rt = makeRuntime(new FakeAnthropic({}));
    const handle = {
      id: "nonexistent",
      seat_id: "s",
      capabilities: new Set<never>(),
    };
    const fakeHandle = handle as unknown as Parameters<typeof rt.takeTurn>[0];
    let threw = false;
    try {
      for await (const _ of rt.takeTurn(fakeHandle, [])) {
        // drain
      }
    } catch (e) {
      threw = true;
      expect(String(e)).toContain("unknown handle");
    }
    expect(threw).toBe(true);
  });

  test("two attaches with the same persona reuse the cached agent definition", async () => {
    const rt = makeRuntime(new FakeAnthropic({}));
    await rt.attach(PERSONA, CTX("s1"));
    await rt.attach(PERSONA, CTX("s2"));
    expect(rt.definitionCacheSize()).toBe(1);
  });

  test("two attaches with different personas yield distinct definitions", async () => {
    const rt = makeRuntime(new FakeAnthropic({}));
    await rt.attach(PERSONA, CTX("s1"));
    await rt.attach({ ...PERSONA, id: "p2", system_prompt: "Different." }, CTX("s2"));
    expect(rt.definitionCacheSize()).toBe(2);
  });
});

describe("DirectSdkRuntime.takeTurn streaming", () => {
  test("yields text deltas as they arrive", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("Hello, world.")],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));

    const chunks: string[] = [];
    for await (const c of rt.takeTurn(handle, [TURN])) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toBe("Hello, world.");
  });

  test("non-empty stream chunks (no empty strings emitted)", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("abcdef")],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    for await (const c of rt.takeTurn(handle, [TURN])) {
      expect(c.length).toBeGreaterThan(0);
    }
  });

  test("response is appended to history; second turn includes prior assistant message", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [
        textStreamEvents("First response."),
        textStreamEvents("Second response."),
      ],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));

    for await (const _ of rt.takeTurn(handle, [TURN])) { /* drain */ }
    for await (const _ of rt.takeTurn(handle, [TURN])) { /* drain */ }

    // The second messages.create call should have seen the prior assistant
    // turn in its history.
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);
    const secondBody = fake.calls[1]!.body as { messages: Array<{ role: string; content: string }> };
    const roles = secondBody.messages.map((m) => m.role);
    expect(roles).toContain("assistant");
  });

  test("early-break cleanup leaves the handle reusable", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("aaaa bbbb cccc dddd"), textStreamEvents("ok again")],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));

    for await (const _c of rt.takeTurn(handle, [TURN])) {
      break; // bail after first chunk
    }

    const next: string[] = [];
    for await (const c of rt.takeTurn(handle, [TURN])) {
      next.push(c);
    }
    expect(next.join("")).toBe("ok again");
  });

  test("mid-stream error propagates out of the async iterable", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("ok")],
      throwMidStreamOnCall: { call: 1, afterEvents: 3 },
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    let threw = false;
    try {
      for await (const _ of rt.takeTurn(handle, [TURN])) { /* drain */ }
    } catch (e) {
      threw = true;
      expect(String(e)).toContain("mid-stream disconnect");
    }
    expect(threw).toBe(true);
  });
});

describe("DirectSdkRuntime.buzzCheck (no coordinator)", () => {
  test("parses buzzer.press tool_use into a BuzzResponse", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [
        toolUseStreamEvents({
          toolName: "buzzer.press",
          toolInput: { intensity: 8, intent: "I have receipts.", nonce: "abc12345" },
        }),
      ],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    const resp = await rt.buzzCheck(handle, [TURN]);
    expect(resp.score).toBe(8);
    expect(resp.intent).toBe("I have receipts.");
    expect(resp.can_pass).toBe(true);
  });

  test("buzzer.pass yields score=0", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [
        toolUseStreamEvents({
          toolName: "buzzer.pass",
          toolInput: { reason: "skip", nonce: "abc12345" },
        }),
      ],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    const resp = await rt.buzzCheck(handle, [TURN]);
    expect(resp.score).toBe(0);
    expect(resp.can_pass).toBe(true);
  });

  test("no tool call → safe default", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("idk")],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    const resp = await rt.buzzCheck(handle, [TURN]);
    expect(resp.score).toBe(0);
    expect(resp.intent).toBe("");
  });

  test("score is clamped to [0, 10]", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [
        toolUseStreamEvents({
          toolName: "buzzer.press",
          toolInput: { intensity: 99, intent: "loud", nonce: "abc12345" },
        }),
      ],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    const resp = await rt.buzzCheck(handle, [TURN]);
    expect(resp.score).toBe(10);
  });
});

describe("DirectSdkRuntime.buzzCheck (with BuzzCoordinator)", () => {
  test("registers a waiter with min-8-char nonce and resolves via the coordinator", async () => {
    const observedKeys: BuzzWaiterKey[] = [];
    const coord: BuzzCoordinator = {
      wait: async (key: BuzzWaiterKey) => {
        observedKeys.push(key);
        const r: BuzzWaiterResolution = {
          kind: "pressed",
          score: 7,
          intent: "via mcp",
        };
        return r;
      },
      cancel: () => {},
    };
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("(stream ignored)")],
    });
    const rt = makeRuntime(fake, coord);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    const resp = await rt.buzzCheck(handle, [TURN]);
    expect(resp.score).toBe(7);
    expect(resp.intent).toBe("via mcp");
    expect(observedKeys).toHaveLength(1);
    expect(observedKeys[0]!.session_id).toBe("sess1");
    expect(observedKeys[0]!.seat_id).toBe("s1");
    expect(observedKeys[0]!.nonce.length).toBeGreaterThanOrEqual(8);
  });

  test("timeout from coordinator yields score=0, can_pass=true", async () => {
    const coord: BuzzCoordinator = {
      wait: async () => ({ kind: "timeout" }),
      cancel: () => {},
    };
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("stream")],
    });
    const rt = makeRuntime(fake, coord);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    const resp = await rt.buzzCheck(handle, [TURN]);
    expect(resp.score).toBe(0);
    expect(resp.intent).toBe("");
    expect(resp.can_pass).toBe(true);
  });
});

describe("DirectSdkRuntime pause/resume", () => {
  test("pause and resume are no-ops and do not break subsequent turns", async () => {
    const fake = new FakeAnthropic({
      inlineEvents: [textStreamEvents("hi")],
    });
    const rt = makeRuntime(fake);
    const handle = await rt.attach(PERSONA, CTX("s1"));
    await rt.pause(handle);
    await rt.resume(handle);
    const chunks: string[] = [];
    for await (const c of rt.takeTurn(handle, [TURN])) chunks.push(c);
    expect(chunks.join("")).toBe("hi");
  });
});
