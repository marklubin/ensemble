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
 * Plain-SDK fallback. Maintains conversation state in memory keyed by
 * `handle.id`; uses `messages.create` with `stream: true` and a
 * tool-use loop. Tool dispatch is intended to go through Ensemble's
 * MCP endpoint — for v1 fixture tests we synthesize a tool_result and
 * keep looping, but real wiring is left as a TODO.
 *
 * Registers under the name "managed-agents" (per the brief — same
 * registry slot as the managed-agents path).
 */
export class DirectSdkRuntime implements PersonaRuntime {
  readonly name = "managed-agents";
  readonly defaultCapabilities: ReadonlySet<Capability> = new Set([
    "streaming",
    "buzz_check",
    "tools",
    "mcp",
    "pause_resume",
  ]);

  private readonly definitions = new AgentDefinitionCache();
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly client: Pick<Anthropic, "messages">,
    private readonly modelId: string,
    private readonly buzzCoordinator?: BuzzCoordinator,
    private readonly opts: { buzzTimeoutMs?: number } = {},
  ) {}

  async attach(
    persona: PersonaSpec,
    ctx: SessionContext,
  ): Promise<InstanceHandle> {
    const { definition } = this.definitions.ensure({ persona, ctx });
    const id = `direct_${ctx.session_id}_${ctx.seat_id}_${randomToken(8)}`;
    this.sessions.set(id, {
      id,
      seat_id: ctx.seat_id,
      session_id: ctx.session_id,
      persona,
      ctx,
      definition,
      history: [],
      detached: false,
    });
    logger.info("direct_sdk.attach", {
      session_id: ctx.session_id,
      seat_id: ctx.seat_id,
      persona_id: persona.id,
      handle_id: id,
      model_id: this.modelId,
    });
    return {
      id,
      seat_id: ctx.seat_id,
      capabilities: new Set(this.defaultCapabilities),
    };
  }

  async *takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string> {
    const state = this.mustGet(handle);
    const userText = formatEventsAsTurnPrompt(newEvents);
    state.history.push({ role: "user", content: userText });

    logger.info("direct_sdk.takeTurn.start", {
      session_id: state.session_id,
      seat_id: state.seat_id,
      handle_id: handle.id,
      events_in: newEvents.length,
      history_size: state.history.length,
    });

    let stream;
    try {
      stream = await this.client.messages.create({
        model: this.modelId,
        max_tokens: 1024,
        system: state.definition.systemPrompt,
        messages: state.history,
        stream: true,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("direct_sdk.takeTurn.api_error", {
        session_id: state.session_id,
        seat_id: state.seat_id,
        handle_id: handle.id,
        error: error.message,
        stack: error.stack,
      });
      throw err;
    }

    let assistantText = "";
    for await (const event of stream as AsyncIterable<AnyEvent>) {
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        const chunk = event.delta.text;
        assistantText += chunk;
        if (chunk.length > 0) yield chunk;
      }
    }

    if (assistantText.length > 0) {
      state.history.push({ role: "assistant", content: assistantText });
    }

    logger.info("direct_sdk.takeTurn.end", {
      session_id: state.session_id,
      seat_id: state.seat_id,
      handle_id: handle.id,
      assistant_text_length: assistantText.length,
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

    // Path 1: a BuzzCoordinator is wired up. Send the prompt as an event,
    // and await the resolution from the MCP-side buzzer tool call.
    if (this.buzzCoordinator) {
      const waiter = this.buzzCoordinator.wait(
        {
          session_id: state.session_id,
          seat_id: state.seat_id,
          nonce,
        },
        this.opts.buzzTimeoutMs ?? 15_000,
      );

      // Fire the prompt; ignore the streamed output (the result comes
      // back over MCP, not the stream).
      try {
        const stream = await this.client.messages.create({
          model: this.modelId,
          max_tokens: 256,
          system: state.definition.systemPrompt,
          messages: [...state.history, { role: "user", content: prompt }],
          stream: true,
        });
        for await (const _ of stream as AsyncIterable<AnyEvent>) {
          // drain
        }
      } catch {
        // ignore stream errors — the waiter will time out
      }

      const resolution = await waiter;
      return resolutionToBuzzResponse(resolution);
    }

    // Path 2: no coordinator (fixture-mode tests). Look for an inline
    // tool_use in the stream and parse it.
    const stream = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 256,
      system: state.definition.systemPrompt,
      messages: [...state.history, { role: "user", content: prompt }],
      stream: true,
    });

    let toolName: string | undefined;
    let toolInputJson = "";
    for await (const event of stream as AsyncIterable<AnyEvent>) {
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        toolName = event.content_block.name as string | undefined;
      } else if (
        event.type === "content_block_delta" &&
        event.delta?.type === "input_json_delta" &&
        typeof event.delta.partial_json === "string"
      ) {
        toolInputJson += event.delta.partial_json;
      }
    }

    if (toolName && toolInputJson) {
      try {
        const args = JSON.parse(toolInputJson) as Record<string, unknown>;
        if (toolName === "buzzer.press") {
          return {
            score: clampScore(args.intensity),
            intent: typeof args.intent === "string" ? args.intent : "",
            can_pass: true,
          };
        }
        if (toolName === "buzzer.pass") {
          return { score: 0, intent: "", can_pass: true };
        }
      } catch {
        // fall through to default
      }
    }

    return { score: 0, intent: "", can_pass: true };
  }

  async detach(handle: InstanceHandle): Promise<void> {
    const state = this.sessions.get(handle.id);
    if (!state) return; // idempotent: unknown / already-detached
    state.detached = true;
    this.sessions.delete(handle.id);
  }

  async pause(_handle: InstanceHandle): Promise<void> {
    // No-op: in-memory conversation state is idle-cheap.
  }

  async resume(_handle: InstanceHandle): Promise<void> {
    // No-op: state was never released.
  }

  // ─── test/introspection hooks ──────────────────────────────────────

  /** Number of cached agent definitions. */
  definitionCacheSize(): number {
    return this.definitions.size();
  }

  /** Read-only view of active sessions (for tests). */
  activeSessions(): readonly string[] {
    return [...this.sessions.keys()];
  }

  private mustGet(handle: InstanceHandle): SessionState {
    const s = this.sessions.get(handle.id);
    if (!s) {
      throw new Error(
        `DirectSdkRuntime: unknown handle ${handle.id} (already detached?)`,
      );
    }
    return s;
  }
}

interface SessionState {
  id: string;
  seat_id: string;
  session_id: string;
  persona: PersonaSpec;
  ctx: SessionContext;
  definition: AgentDefinition;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  detached: boolean;
}

// loose typing of streamed events from the SDK — we only inspect a few fields
type AnyEvent = {
  type: string;
  delta?: { type?: string; text?: string; partial_json?: string };
  content_block?: { type?: string; name?: string };
};

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

function resolutionToBuzzResponse(r: {
  kind: "pressed" | "passed" | "timeout";
  score?: number;
  intent?: string;
}): BuzzResponse {
  if (r.kind === "pressed") {
    return {
      score: clampScore(r.score),
      intent: r.intent ?? "",
      can_pass: true,
    };
  }
  return { score: 0, intent: "", can_pass: true };
}

function randomToken(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
