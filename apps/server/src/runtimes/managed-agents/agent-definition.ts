import { createHash } from "node:crypto";
import type { PersonaSpec, SessionContext } from "@ensemble/shared";

/**
 * An "Agent definition" in Managed Agents is a server-side resource
 * tied to (system_prompt, allowed tools, MCP server config). The same
 * persona instantiated into many sessions should reuse the same Agent
 * definition; we cache it by content hash.
 *
 * In the DirectSdkRuntime fallback there is no remote definition — we
 * still use this cache to memoize the "compiled" system prompt + tool
 * list per persona so attach is cheap.
 */
export interface AgentDefinition {
  /** Stable id derived from the content hash. */
  id: string;
  /** SHA256 hex of (system_prompt + tools_allowed + mcp_url). */
  contentHash: string;
  /** Full system prompt that gets passed to messages.create / agent. */
  systemPrompt: string;
  /** Tool names the persona is allowed to call. */
  toolsAllowed: string[];
  /** MCP server URL bound to this definition. */
  mcpUrl: string;
}

export interface AgentDefinitionInput {
  persona: PersonaSpec;
  ctx: Pick<
    SessionContext,
    | "ensemble_mcp_url"
    | "scenario"
    | "scenario_format"
    | "cast"
    | "target_words_per_turn"
  >;
}

/**
 * Pure, deterministic content hash. Two attaches with the same persona +
 * MCP URL + scenario produce the same hash; differences in any of those
 * differ. Scenario participates because the prompt depends on it; reusing
 * a cached definition across scenarios would silently swap topics.
 */
export function hashAgentDefinition(input: AgentDefinitionInput): string {
  const payload = JSON.stringify({
    system_prompt: input.persona.system_prompt,
    voice_signature: input.persona.voice_signature ?? null,
    role: input.persona.role ?? null,
    tools_allowed: [...input.persona.tools_allowed].sort(),
    mcp_url: input.ctx.ensemble_mcp_url,
    scenario: input.ctx.scenario,
    scenario_format: input.ctx.scenario_format,
    cast: input.ctx.cast.map((s) => ({
      seat_id: s.seat_id,
      persona_name: s.persona_name,
      role: s.role ?? null,
    })),
    target_words_per_turn: input.ctx.target_words_per_turn ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Build the system prompt sent to the underlying agent. Includes:
 *   - persona's system_prompt (their character / voice)
 *   - the actual scenario being debated/discussed
 *   - the cast (so the persona knows who else is in the room)
 *   - role in the scene (Pro / Con / etc)
 *   - tool guidance for the MCP host
 */
export function buildSystemPrompt(
  persona: PersonaSpec,
  ctx?: Pick<
    SessionContext,
    "scenario" | "scenario_format" | "cast" | "target_words_per_turn"
  >,
): string {
  const parts: string[] = [persona.system_prompt.trim()];

  if (ctx) {
    const verb = scenarioVerb(ctx.scenario_format);
    parts.push(
      [
        "",
        `# The scene`,
        ``,
        `You are participating in a multi-persona session. The ${verb}:`,
        ``,
        ctx.scenario.trim(),
        ``,
        `Stay focused on this specific topic. Respond in first person as your character.`,
      ].join("\n"),
    );

    const otherSeats = ctx.cast
      .filter((s) => s.persona_name !== persona.name)
      .map(
        (s) =>
          `- **${s.persona_name}**${s.role ? ` (${s.role})` : ""}`,
      );
    if (otherSeats.length > 0) {
      parts.push(
        [
          "",
          `# Other participants`,
          "",
          otherSeats.join("\n"),
          "",
          `Respond to what they actually said, by name when relevant.`,
        ].join("\n"),
      );
    }
  }

  if (persona.voice_signature) {
    parts.push(`\n**Voice:** ${persona.voice_signature}`);
  }
  if (persona.role) {
    parts.push(`\n**Your role in this scene:** ${persona.role}`);
  }
  if (persona.tools_allowed.length > 0) {
    parts.push(
      `\nYou have access to these tools via MCP: ${persona.tools_allowed.join(", ")}. ` +
        `Use them when appropriate. During buzz checks you MUST use buzzer.press or buzzer.pass.`,
    );
  }
  if (ctx?.target_words_per_turn) {
    const w = ctx.target_words_per_turn;
    parts.push(
      `\n**Response length.** Keep each turn to about ${w} words — ` +
        `roughly ${Math.max(1, Math.round(w / 40))} short paragraph${
          w >= 80 ? "s" : ""
        }. Make your strongest point and stop; don't pad. ` +
        `Trust the reader; they'll see your reply alongside the others.`,
    );
  }
  return parts.join("\n");
}

function scenarioVerb(format: string): string {
  switch (format) {
    case "motion":
      return "motion before the table is";
    case "question":
      return "question on the table is";
    case "scenario":
      return "scenario being explored is";
    case "document":
      return "document under discussion concerns";
    default:
      return "topic of this session is";
  }
}

/**
 * Process-local cache of agent definitions, keyed by content hash.
 * Pure data, no I/O. The runtime owns one of these.
 */
export class AgentDefinitionCache {
  private readonly cache = new Map<string, AgentDefinition>();

  /** Reads cached entry or returns undefined. */
  get(hash: string): AgentDefinition | undefined {
    return this.cache.get(hash);
  }

  /** Inserts an entry, returning the entry. */
  set(def: AgentDefinition): AgentDefinition {
    this.cache.set(def.contentHash, def);
    return def;
  }

  /** Build or fetch an AgentDefinition for this persona+ctx. */
  ensure(input: AgentDefinitionInput): {
    definition: AgentDefinition;
    cached: boolean;
  } {
    const hash = hashAgentDefinition(input);
    const existing = this.cache.get(hash);
    if (existing) return { definition: existing, cached: true };
    const def: AgentDefinition = {
      id: `agentdef_${hash.slice(0, 16)}`,
      contentHash: hash,
      systemPrompt: buildSystemPrompt(input.persona, input.ctx),
      toolsAllowed: [...input.persona.tools_allowed],
      mcpUrl: input.ctx.ensemble_mcp_url,
    };
    this.cache.set(hash, def);
    return { definition: def, cached: false };
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}
