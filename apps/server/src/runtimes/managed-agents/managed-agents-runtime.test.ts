import { describe, test, expect } from "bun:test";
import {
  ManagedAgentsRuntime,
  type ManagedAgentsClient,
} from "./managed-agents-runtime.ts";
import { FakeAnthropic, textStreamEvents } from "./test-helpers/fake-anthropic.ts";
import type { PersonaSpec, SessionContext, TurnEvent } from "@ensemble/shared";

const PERSONA: PersonaSpec = {
  id: "p1",
  name: "Ada",
  system_prompt: "You are Ada.",
  tools_allowed: ["buzzer.press"],
  memory_policy: "ephemeral",
};

const CTX: SessionContext = {
  session_id: "sess1",
  seat_id: "s1",
  scenario: "test",
  scenario_format: "motion",
  cast: [],
  ensemble_mcp_url: "https://mcp.test/ensemble",
  ensemble_mcp_token: "tok",
};

const TURN: TurnEvent = {
  kind: "turn",
  seat_id: "other",
  speaker: "Other",
  content: "Hi.",
  round: 1,
  timestamp: "2026-05-12T10:00:00.000Z",
};

describe("ManagedAgentsRuntime", () => {
  test("isAvailable returns false when the SDK lacks beta.managedAgents", () => {
    const noBeta = {} as unknown;
    expect(ManagedAgentsRuntime.isAvailable(noBeta)).toBe(false);
  });

  test("isAvailable returns true when FakeAnthropic enables the beta surface", () => {
    const fake = new FakeAnthropic({ enableManagedAgents: true });
    expect(ManagedAgentsRuntime.isAvailable(fake)).toBe(true);
  });

  test("attach + takeTurn round trip via the managed-agents beta surface", async () => {
    const fake = new FakeAnthropic({
      enableManagedAgents: true,
      inlineEvents: [textStreamEvents("Hello.")],
    });
    const rt = new ManagedAgentsRuntime(
      fake as unknown as ManagedAgentsClient,
      "model-x",
    );
    const handle = await rt.attach(PERSONA, CTX);
    expect(handle.id).toMatch(/^ma_session_/);
    const chunks: string[] = [];
    for await (const c of rt.takeTurn(handle, [TURN])) chunks.push(c);
    expect(chunks.join("")).toBe("Hello.");
    await rt.detach(handle);
    // verify archive was called
    const apis = fake.calls.map((c) => c.api);
    expect(apis).toContain("managed_agents.archive");
  });

  test("attach caches agent definitions across seats with the same persona", async () => {
    const fake = new FakeAnthropic({ enableManagedAgents: true });
    const rt = new ManagedAgentsRuntime(fake as unknown as ManagedAgentsClient, "m");
    await rt.attach(PERSONA, CTX);
    await rt.attach(PERSONA, { ...CTX, seat_id: "s2" });
    expect(rt.definitionCacheSize()).toBe(1);
  });
});
