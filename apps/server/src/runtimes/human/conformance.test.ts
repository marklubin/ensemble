/**
 * L2 — SPI conformance for HumanRuntime.
 *
 * The L2 suite shipped in Phase 0 (`@ensemble/spi-conformance`) is a
 * skeleton: Agent A is filling in the 25 cases per the plan. We still
 * invoke `runConformanceSuite` so that as soon as Agent A's suite lands
 * (post-merge), HumanRuntime is automatically validated against it —
 * the factory below feeds the suite a runtime instance backed by a
 * scripted UiBridge so the suite never needs a real client.
 *
 * Per the brief: the suite must accept the absence of `buzz_check`.
 * Our `buzzCheck()` returns the well-formed no-buzz response shape,
 * so suites that call it (regardless of capability) get a valid
 * `BuzzResponse`.
 *
 * In addition to invoking the (currently no-op) shared suite, we run a
 * local SPI-shape verification so this file is meaningful before Agent A's
 * cases land.
 */

import { describe, expect, test } from "bun:test";
import {
  runConformanceSuite,
  type ConformanceFactory,
} from "@ensemble/spi-conformance";
import {
  BuzzResponse,
  type InstanceHandle,
  type PersonaRuntime,
  type PersonaSpec,
  type SessionContext,
  type TurnEvent,
} from "@ensemble/shared";
import { HumanRuntime } from "./index.ts";
import { UiBridge } from "../../ui-bridge/index.ts";

/**
 * Factory wraps HumanRuntime in a scripted-input shim. The base
 * HumanRuntime only yields chunks that arrive via the UiBridge, so for
 * the conformance suite (which expects a streaming runtime to actually
 * stream when `takeTurn` is called) we auto-ingest a small scripted
 * sequence ("ok" + submit) on every take-turn. This mirrors the
 * real-world flow where a human types characters.
 *
 * The turn_id format depends on HumanRuntime's internal counter:
 *   `${handle.id}-turn-${turnSeq}` where turnSeq starts at 0 and
 *   increments per takeTurn. The shim mirrors that counter so the
 *   ingested chunk matches the runtime's active turn_id.
 */
const factory: ConformanceFactory = async () => {
  const bridge = new UiBridge();
  const base = new HumanRuntime(bridge, { turnTimeoutMs: 500 });
  const sessionsByHandle = new Map<string, string>();
  const turnCounts = new Map<string, number>();

  const scripted: PersonaRuntime = {
    name: base.name,
    defaultCapabilities: base.defaultCapabilities,
    async attach(persona: PersonaSpec, ctx: SessionContext) {
      const h = await base.attach(persona, ctx);
      sessionsByHandle.set(h.id, ctx.session_id);
      turnCounts.set(h.id, 0);
      return h;
    },
    buzzCheck(handle: InstanceHandle, recentTurns: TurnEvent[]) {
      return base.buzzCheck(handle, recentTurns);
    },
    async detach(handle: InstanceHandle) {
      sessionsByHandle.delete(handle.id);
      turnCounts.delete(handle.id);
      return base.detach(handle);
    },
    takeTurn(handle: InstanceHandle, newEvents: TurnEvent[]) {
      const session_id = sessionsByHandle.get(handle.id);
      const seq = (turnCounts.get(handle.id) ?? 0) + 1;
      turnCounts.set(handle.id, seq);
      const turn_id = `${handle.id}-turn-${seq}`;
      if (session_id !== undefined) {
        queueMicrotask(() => {
          bridge.ingest(
            { kind: "chunk", seat_id: handle.seat_id, turn_id, text: "ok" },
            session_id,
          );
          bridge.ingest(
            { kind: "submit", seat_id: handle.seat_id, turn_id },
            session_id,
          );
        });
      }
      return base.takeTurn(handle, newEvents);
    },
  };
  return { runtime: scripted, fixtureMode: true };
};

runConformanceSuite("human", factory);

describe("HumanRuntime — local SPI shape checks", () => {
  test("name and default capabilities are correct", async () => {
    const { runtime } = await factory();
    expect(runtime.name).toBe("human");
    expect(runtime.defaultCapabilities.has("streaming")).toBe(true);
    expect(runtime.defaultCapabilities.has("buzz_check")).toBe(false);
  });

  test("attach returns a handle whose capability set reflects defaults", async () => {
    const { runtime } = await factory();
    const persona: PersonaSpec = {
      id: "p",
      name: "P",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctx: SessionContext = {
      session_id: "s",
      seat_id: "seat",
      scenario: "",
      scenario_format: "open",
      cast: [],
      ensemble_mcp_url: "http://x/mcp",
      ensemble_mcp_token: "t",
    };
    const h = await runtime.attach(persona, ctx);
    expect(h.capabilities.has("streaming")).toBe(true);
    expect(h.capabilities.has("buzz_check")).toBe(false);
    await runtime.detach(h);
  });

  test("buzzCheck returns a well-formed no-buzz response even though the capability is absent", async () => {
    const { runtime } = await factory();
    const persona: PersonaSpec = {
      id: "p",
      name: "P",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctx: SessionContext = {
      session_id: "s",
      seat_id: "seat",
      scenario: "",
      scenario_format: "open",
      cast: [],
      ensemble_mcp_url: "http://x/mcp",
      ensemble_mcp_token: "t",
    };
    const h = await runtime.attach(persona, ctx);
    const r = await runtime.buzzCheck(h, []);
    // Zod-validate the result against the shared schema.
    const parsed = BuzzResponse.safeParse(r);
    expect(parsed.success).toBe(true);
    expect(r.score).toBe(0);
    expect(r.can_pass).toBe(true);
    await runtime.detach(h);
  });

  test("detach is idempotent", async () => {
    const { runtime } = await factory();
    const persona: PersonaSpec = {
      id: "p",
      name: "P",
      system_prompt: "",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const ctx: SessionContext = {
      session_id: "s",
      seat_id: "seat",
      scenario: "",
      scenario_format: "open",
      cast: [],
      ensemble_mcp_url: "http://x/mcp",
      ensemble_mcp_token: "t",
    };
    const h = await runtime.attach(persona, ctx);
    await runtime.detach(h);
    // Second detach must not throw.
    await runtime.detach(h);
  });
});
