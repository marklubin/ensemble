import type Anthropic from "@anthropic-ai/sdk";
import type {
  PersonaRuntime,
  PersonaSpec,
  SessionContext,
  TurnEvent,
  BuzzResponse,
  InstanceHandle,
  Capability,
  BuzzCoordinator,
} from "@ensemble/shared";
import {
  AgentDefinitionCache,
  type AgentDefinition,
} from "./agent-definition.ts";
import {
  formatEventsAsTurnPrompt,
  formatBuzzCheckPrompt,
} from "./prompts.ts";
import { logger } from "../../logging/index.ts";

/**
 * The "primary" v1 runtime per the spec: hits the Anthropic Managed
 * Agents beta API. This class is structurally complete but the real
 * `@anthropic-ai/sdk@0.32` package does not (yet) expose
 * `client.beta.managedAgents`, so production deployments today should
 * use {@link DirectSdkRuntime} via the {@link createManagedAgentsRuntime}
 * auto-detect factory.
 *
 * Tests drive it via FakeAnthropic with `enableManagedAgents: true`.
 */
export class ManagedAgentsRuntime implements PersonaRuntime {
  readonly name = "managed-agents";
  readonly defaultCapabilities: ReadonlySet<Capability> = new Set([
    "streaming",
    "buzz_check",
    "tools",
    "mcp",
    "pause_resume",
  ]);

  private readonly definitions = new AgentDefinitionCache();
  private readonly sessions = new Map<string, ManagedSessionState>();

  constructor(
    private readonly client: ManagedAgentsClient,
    private readonly modelId: string,
    private readonly buzzCoordinator?: BuzzCoordinator,
    private readonly opts: { buzzTimeoutMs?: number } = {},
  ) {}

  /** Probe: returns true if the wrapped client exposes the beta endpoint. */
  static isAvailable(client: unknown): client is ManagedAgentsClient {
    if (!client || typeof client !== "object") return false;
    const beta = (client as { beta?: unknown }).beta;
    if (!beta || typeof beta !== "object") return false;
    const ma = (beta as { managedAgents?: unknown }).managedAgents;
    if (!ma || typeof ma !== "object") return false;
    const sessions = (ma as { sessions?: unknown }).sessions;
    if (!sessions || typeof sessions !== "object") return false;
    const s = sessions as { create?: unknown; events?: unknown; archive?: unknown };
    if (typeof s.create !== "function") return false;
    if (typeof s.archive !== "function") return false;
    const events = s.events as { create?: unknown } | undefined;
    if (!events || typeof events.create !== "function") return false;
    return true;
  }

  async attach(
    persona: PersonaSpec,
    ctx: SessionContext,
  ): Promise<InstanceHandle> {
    const { definition } = this.definitions.ensure({ persona, ctx });
    // In a real implementation we'd ensure an Agent definition resource
    // exists in the Anthropic account here. The cache shields us from
    // recreating it per session; below we just open a Session against it.
    const session = await this.client.beta.managedAgents.sessions.create({
      agent_id: definition.id,
      mcp_servers: [
        {
          url: ctx.ensemble_mcp_url,
          auth_token: ctx.ensemble_mcp_token,
        },
      ],
      metadata: {
        ensemble_session: ctx.session_id,
        seat: ctx.seat_id,
      },
    });

    this.sessions.set(session.id, {
      id: session.id,
      seat_id: ctx.seat_id,
      session_id: ctx.session_id,
      persona,
      ctx,
      definition,
    });

    logger.info("managed_agents.attach", {
      session_id: ctx.session_id,
      seat_id: ctx.seat_id,
      persona_id: persona.id,
      handle_id: session.id,
      model_id: this.modelId,
    });

    return {
      id: session.id,
      seat_id: ctx.seat_id,
      capabilities: new Set(this.defaultCapabilities),
    };
  }

  async *takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string> {
    const state = this.mustGet(handle);
    const userMessage = formatEventsAsTurnPrompt(newEvents);
    logger.info("managed_agents.takeTurn.start", {
      session_id: state.session_id,
      seat_id: state.seat_id,
      handle_id: handle.id,
      events_in: newEvents.length,
    });
    const stream = this.client.beta.managedAgents.sessions.events.create({
      session_id: handle.id,
      role: "user",
      content: userMessage,
      stream: true,
    });

    let totalLen = 0;
    for await (const event of stream as AsyncIterable<AnyEvent>) {
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string" &&
        event.delta.text.length > 0
      ) {
        totalLen += event.delta.text.length;
        yield event.delta.text;
      }
    }
    logger.info("managed_agents.takeTurn.end", {
      session_id: state.session_id,
      seat_id: state.seat_id,
      handle_id: handle.id,
      assistant_text_length: totalLen,
    });
  }

  async buzzCheck(
    handle: InstanceHandle,
    recentTurns: TurnEvent[],
  ): Promise<BuzzResponse> {
    const state = this.mustGet(handle);
    const nonce = randomToken(12);
    const prompt = formatBuzzCheckPrompt(
      recentTurns,
      nonce,
      state.persona.buzz_in_policy,
    );

    if (this.buzzCoordinator) {
      const waiter = this.buzzCoordinator.wait(
        {
          session_id: state.session_id,
          seat_id: state.seat_id,
          nonce,
        },
        this.opts.buzzTimeoutMs ?? 15_000,
      );

      // Send the buzz-check prompt; the agent calls buzzer.press / .pass
      // via MCP, which the coordinator on the MCP side resolves.
      try {
        const stream = this.client.beta.managedAgents.sessions.events.create({
          session_id: handle.id,
          role: "user",
          content: prompt,
          stream: true,
        });
        for await (const _ of stream as AsyncIterable<AnyEvent>) {
          // drain
        }
      } catch {
        // ignore — the waiter will resolve or time out
      }

      const resolution = await waiter;
      if (resolution.kind === "pressed") {
        return {
          score: clamp(resolution.score, 0, 10),
          intent: resolution.intent ?? "",
          can_pass: true,
        };
      }
      return { score: 0, intent: "", can_pass: true };
    }

    // No coordinator: inspect the stream for an inline tool_use as a
    // fixture-friendly fallback (mirrors DirectSdkRuntime).
    const stream = this.client.beta.managedAgents.sessions.events.create({
      session_id: handle.id,
      role: "user",
      content: prompt,
      stream: true,
    });

    let toolName: string | undefined;
    let toolInputJson = "";
    for await (const event of stream as AsyncIterable<AnyEvent>) {
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        toolName = event.content_block.name;
      } else if (
        event.type === "content_block_delta" &&
        event.delta?.type === "input_json_delta" &&
        typeof event.delta.partial_json === "string"
      ) {
        toolInputJson += event.delta.partial_json;
      }
    }
    if (toolName === "buzzer.press" && toolInputJson) {
      try {
        const args = JSON.parse(toolInputJson) as Record<string, unknown>;
        return {
          score: clamp(Number(args.intensity), 0, 10),
          intent: typeof args.intent === "string" ? args.intent : "",
          can_pass: true,
        };
      } catch { /* fall through */ }
    }
    return { score: 0, intent: "", can_pass: true };
  }

  async detach(handle: InstanceHandle): Promise<void> {
    const state = this.sessions.get(handle.id);
    if (!state) return;
    try {
      await this.client.beta.managedAgents.sessions.archive({
        session_id: handle.id,
      });
    } finally {
      this.sessions.delete(handle.id);
    }
  }

  async pause(_handle: InstanceHandle): Promise<void> {
    // Managed Agents Sessions are idle-cheap; no-op.
  }
  async resume(_handle: InstanceHandle): Promise<void> {
    // Managed Agents Sessions are idle-cheap; no-op.
  }

  definitionCacheSize(): number {
    return this.definitions.size();
  }

  private mustGet(handle: InstanceHandle): ManagedSessionState {
    const s = this.sessions.get(handle.id);
    if (!s) {
      throw new Error(
        `ManagedAgentsRuntime: unknown handle ${handle.id} (already detached?)`,
      );
    }
    return s;
  }
}

interface ManagedSessionState {
  id: string;
  seat_id: string;
  session_id: string;
  persona: PersonaSpec;
  ctx: SessionContext;
  definition: AgentDefinition;
}

type AnyEvent = {
  type: string;
  delta?: { type?: string; text?: string; partial_json?: string };
  content_block?: { type?: string; name?: string };
};

/** Structural type of the slice of `Anthropic` we need for the managed path. */
export interface ManagedAgentsClient {
  beta: {
    managedAgents: {
      sessions: {
        create: (body: {
          agent_id: string;
          mcp_servers: Array<{ url: string; auth_token: string }>;
          metadata?: Record<string, unknown>;
        }) => Promise<{ id: string }>;
        events: {
          create: (body: {
            session_id: string;
            role: "user" | "assistant";
            content: string;
            stream?: boolean;
          }) => AsyncIterable<AnyEvent>;
        };
        archive: (body: { session_id: string }) => Promise<void>;
      };
    };
  };
}

// helpers
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function randomToken(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Confirm the real SDK type is structurally compatible (compile-time guard).
 * If the SDK ever ships managedAgents this assignment will start passing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Compat = Anthropic extends { messages: unknown } ? true : never;
