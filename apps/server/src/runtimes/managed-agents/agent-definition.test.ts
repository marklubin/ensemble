import { describe, test, expect } from "bun:test";
import {
  AgentDefinitionCache,
  hashAgentDefinition,
  buildSystemPrompt,
} from "./agent-definition.ts";
import type { PersonaSpec, SessionContext } from "@ensemble/shared";

const PERSONA_A: PersonaSpec = {
  id: "p_ada",
  name: "Ada",
  system_prompt: "You are Ada, a programmer of the analytical engine.",
  role: "Pro",
  voice_signature: "precise, mathematical",
  tools_allowed: ["buzzer.press", "buzzer.pass", "memory.write"],
  memory_policy: "ephemeral",
};

const PERSONA_B: PersonaSpec = {
  id: "p_grace",
  name: "Grace",
  system_prompt: "You are Grace, a pioneer of compiler design.",
  role: "Con",
  tools_allowed: ["buzzer.press", "buzzer.pass"],
  memory_policy: "ephemeral",
};

const CTX = (seat: string): SessionContext => ({
  session_id: "sess_test",
  seat_id: seat,
  scenario: "Should we have invented assembly?",
  scenario_format: "motion",
  cast: [],
  ensemble_mcp_url: "https://mcp.test/ensemble",
  ensemble_mcp_token: "tok_x",
});

describe("AgentDefinitionCache", () => {
  test("two attaches with the same persona reuse the cached definition", () => {
    const cache = new AgentDefinitionCache();
    const first = cache.ensure({ persona: PERSONA_A, ctx: CTX("seat_1") });
    const second = cache.ensure({ persona: PERSONA_A, ctx: CTX("seat_2") });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(first.definition.id).toBe(second.definition.id);
    expect(first.definition.contentHash).toBe(second.definition.contentHash);
    expect(cache.size()).toBe(1);
  });

  test("different personas yield distinct definitions", () => {
    const cache = new AgentDefinitionCache();
    const a = cache.ensure({ persona: PERSONA_A, ctx: CTX("s") });
    const b = cache.ensure({ persona: PERSONA_B, ctx: CTX("s") });
    expect(a.definition.id).not.toBe(b.definition.id);
    expect(a.definition.contentHash).not.toBe(b.definition.contentHash);
    expect(cache.size()).toBe(2);
  });

  test("different MCP URL produces a distinct definition (tool surface changed)", () => {
    const ctxA = CTX("s1");
    const ctxB: SessionContext = { ...CTX("s1"), ensemble_mcp_url: "https://mcp2.test/x" };
    const ha = hashAgentDefinition({ persona: PERSONA_A, ctx: ctxA });
    const hb = hashAgentDefinition({ persona: PERSONA_A, ctx: ctxB });
    expect(ha).not.toBe(hb);
  });

  test("tools_allowed order does not affect the hash", () => {
    const personaSorted: PersonaSpec = {
      ...PERSONA_A,
      tools_allowed: ["buzzer.press", "buzzer.pass", "memory.write"],
    };
    const personaReversed: PersonaSpec = {
      ...PERSONA_A,
      tools_allowed: ["memory.write", "buzzer.pass", "buzzer.press"],
    };
    const h1 = hashAgentDefinition({ persona: personaSorted, ctx: CTX("s") });
    const h2 = hashAgentDefinition({ persona: personaReversed, ctx: CTX("s") });
    expect(h1).toBe(h2);
  });

  test("hash is stable across calls", () => {
    const h1 = hashAgentDefinition({ persona: PERSONA_A, ctx: CTX("s") });
    const h2 = hashAgentDefinition({ persona: PERSONA_A, ctx: CTX("s") });
    expect(h1).toBe(h2);
  });

  test("buildSystemPrompt embeds voice + role + tools hint when present", () => {
    const sp = buildSystemPrompt(PERSONA_A);
    expect(sp).toContain("Ada");
    expect(sp).toContain("precise, mathematical");
    expect(sp).toContain("Pro");
    expect(sp).toContain("buzzer.press");
  });

  test("buildSystemPrompt omits optional sections when absent", () => {
    const minimal: PersonaSpec = {
      id: "x",
      name: "X",
      system_prompt: "Be brief.",
      tools_allowed: [],
      memory_policy: "ephemeral",
    };
    const sp = buildSystemPrompt(minimal);
    expect(sp).toContain("Be brief.");
    expect(sp).not.toContain("Voice:");
    expect(sp).not.toContain("Role in this scene:");
  });
});
