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
import { BuzzResponse, type PersonaSpec, type SessionContext } from "@ensemble/shared";
import { HumanRuntime } from "./index.ts";
import { UiBridge } from "../../ui-bridge/index.ts";

const factory: ConformanceFactory = async () => {
  const bridge = new UiBridge();
  // Default to a generous timeout so the factory-produced runtime can be
  // exercised in tests that don't immediately drive the bridge.
  const runtime = new HumanRuntime(bridge, { turnTimeoutMs: 100 });
  return { runtime, fixtureMode: true };
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
