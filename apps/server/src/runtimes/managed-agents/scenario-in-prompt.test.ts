/**
 * Regression: the scenario must reach the persona's system prompt.
 *
 * Before this test landed, `buildSystemPrompt(persona)` ignored the
 * SessionContext entirely. Personas were debating whatever their
 * persona definition implied, never the actual topic the user set.
 */

import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "./agent-definition.ts";
import type { PersonaSpec, SessionContext } from "@ensemble/shared";

const persona: PersonaSpec = {
  id: "p",
  name: "Alex",
  system_prompt: "You are Alex, a measured infrastructure engineer.",
  role: "Pro",
  tools_allowed: [],
  memory_policy: "ephemeral",
};

const ctx: SessionContext = {
  session_id: "s1",
  seat_id: "pro",
  scenario: "Should small teams pick Bun over Node for new TypeScript services?",
  scenario_format: "motion",
  cast: [
    { seat_id: "pro", persona_id: "p", persona_name: "Alex", role: "Pro", runtime_type: "managed-agents" },
    { seat_id: "con", persona_id: "p2", persona_name: "Jordan", role: "Con", runtime_type: "managed-agents" },
  ],
  ensemble_mcp_url: "http://x/mcp",
  ensemble_mcp_token: "t",
};

describe("buildSystemPrompt scenario embedding", () => {
  test("includes the scenario text verbatim", () => {
    const sp = buildSystemPrompt(persona, ctx);
    expect(sp).toContain("Should small teams pick Bun over Node");
  });

  test("uses the right framing for scenario_format=motion", () => {
    const sp = buildSystemPrompt(persona, ctx);
    expect(sp.toLowerCase()).toContain("motion before the table");
  });

  test("lists other participants by name + role", () => {
    const sp = buildSystemPrompt(persona, ctx);
    expect(sp).toContain("Jordan");
    expect(sp).toContain("Con");
    // Doesn't list self.
    expect(sp.match(/Alex/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test("backward-compatible when ctx omitted (existing callers)", () => {
    const sp = buildSystemPrompt(persona);
    expect(sp).toContain("You are Alex");
    expect(sp).not.toContain("Scene");
  });

  test("question-format wording is distinct from motion-format", () => {
    const qctx: SessionContext = { ...ctx, scenario_format: "question" };
    const sp = buildSystemPrompt(persona, qctx);
    expect(sp.toLowerCase()).toContain("question on the table");
  });
});
