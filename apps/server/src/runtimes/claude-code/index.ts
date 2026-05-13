/**
 * ClaudeCodeRuntime — SPI implementation that drives a Claude Code
 * session as one seat in an Ensemble simulation.
 *
 * Design:
 *   - All transport concerns sit behind `ClaudeCodeTransport`. Tests
 *     inject `MockMcpTransport`; production (post-v1.5) injects
 *     `LocalCliTransport`.
 *   - Buzz-checks ride the same MCP-tool pattern as Agent C: register
 *     a `BuzzCoordinator` waiter keyed by a nonce, send a buzz-check
 *     prompt that includes the nonce, and await the resolution that
 *     the MCP server (Agent B) generates when the agent calls
 *     `buzzer.press` / `buzzer.pass`.
 *   - The feature flag (`CLAUDE_CODE_RUNTIME_ENABLED`) is enforced on
 *     `attach` so that a misconfigured registry surfaces a clean,
 *     typed error rather than an opaque transport failure.
 */

import type {
  BuzzResponse,
  Capability,
  InstanceHandle,
  PersonaRuntime,
  PersonaSpec,
  SessionContext,
  TurnEvent,
} from "@ensemble/shared";
import type {
  BuzzCoordinator,
  BuzzWaiterKey,
} from "@ensemble/shared/buzz-coordinator";

import type { ClaudeCodeTransport } from "./transport.ts";
import {
  RuntimeDisabledError,
  type ClaudeCodeMessage,
  type ClaudeCodeRuntimeConfig,
  type SessionBrief,
} from "./types.ts";

const DEFAULT_BUZZ_TIMEOUT_MS = 10_000;

const DEFAULT_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "streaming",
  "buzz_check",
  "tools",
  "mcp",
] satisfies Capability[]);

interface InternalSession {
  ctx: SessionContext;
  persona: PersonaSpec;
  brief: SessionBrief;
}

export class ClaudeCodeRuntime implements PersonaRuntime {
  readonly name = "claude-code";
  readonly defaultCapabilities: ReadonlySet<Capability> = DEFAULT_CAPABILITIES;

  private readonly sessions = new Map<string, InternalSession>();

  constructor(
    private readonly transport: ClaudeCodeTransport,
    private readonly buzzCoordinator: BuzzCoordinator,
    private readonly config: ClaudeCodeRuntimeConfig,
  ) {}

  /** True iff the feature flag is on. Useful for the registry wiring. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  async attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    if (!this.config.enabled) {
      throw new RuntimeDisabledError();
    }
    const brief: SessionBrief = {
      ensemble_session_id: ctx.session_id,
      seat_id: ctx.seat_id,
      persona,
      scenario: ctx.scenario,
      scenario_format: ctx.scenario_format,
      cast: ctx.cast,
      ensemble_mcp_url: ctx.ensemble_mcp_url,
      ensemble_mcp_token: ctx.ensemble_mcp_token,
    };
    const { session_id } = await this.transport.open(brief);
    this.sessions.set(session_id, { ctx, persona, brief });
    return {
      id: session_id,
      seat_id: ctx.seat_id,
      capabilities: this.defaultCapabilities,
    };
  }

  async *takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string> {
    const session = this.requireSession(handle);
    const message: ClaudeCodeMessage = {
      kind: "turn",
      prompt: formatEventsAsTurnPrompt(newEvents),
      events: newEvents,
    };
    for await (const chunk of this.transport.send(handle.id, message)) {
      yield chunk;
    }
    // session is used for symmetry / future per-seat instrumentation
    void session;
  }

  async buzzCheck(
    handle: InstanceHandle,
    recentTurns: TurnEvent[],
  ): Promise<BuzzResponse> {
    const session = this.requireSession(handle);
    const nonce = generateNonce();
    const key: BuzzWaiterKey = {
      session_id: session.ctx.session_id,
      seat_id: handle.seat_id,
      nonce,
    };

    const timeoutMs = this.config.buzzCheckTimeoutMs ?? DEFAULT_BUZZ_TIMEOUT_MS;
    const waiter = this.buzzCoordinator.wait(key, timeoutMs);

    const message: ClaudeCodeMessage = {
      kind: "buzz_check",
      prompt: formatBuzzCheckPrompt(recentTurns, nonce),
      nonce,
      recentTurns,
    };

    // Drain the stream alongside the waiter; the buzzer.press/pass call
    // happens via MCP, not in-band.
    const drain = drainAsyncIterable(this.transport.send(handle.id, message));

    try {
      const resolution = await waiter;
      // Ensure the transport stream is fully drained so the session is
      // ready for the next message.
      await drain.catch(() => {});

      if (resolution.kind === "pressed") {
        return { score: resolution.score, intent: resolution.intent, can_pass: true };
      }
      if (resolution.kind === "passed") {
        return { score: 0, intent: resolution.reason ?? "", can_pass: true };
      }
      // timeout
      return { score: 0, intent: "", can_pass: true };
    } catch (err) {
      this.buzzCoordinator.cancel(key);
      await drain.catch(() => {});
      throw err;
    }
  }

  async detach(handle: InstanceHandle): Promise<void> {
    if (!this.sessions.has(handle.id)) return;
    try {
      await this.transport.close(handle.id);
    } finally {
      this.sessions.delete(handle.id);
    }
  }

  private requireSession(handle: InstanceHandle): InternalSession {
    const session = this.sessions.get(handle.id);
    if (!session) {
      throw new Error(
        `ClaudeCodeRuntime: unknown handle id ${handle.id} (seat ${handle.seat_id}); was attach called?`,
      );
    }
    return session;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function generateNonce(): string {
  // 16 hex chars from crypto.randomUUID minus dashes; comfortably > 8.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function formatEventsAsTurnPrompt(events: TurnEvent[]): string {
  if (events.length === 0) {
    return "It's your turn. Speak in character.";
  }
  const lines = events.map((e) => {
    switch (e.kind) {
      case "turn":
        return `[round ${e.round}] ${e.speaker}: ${e.content}`;
      case "moderator":
        return `[round ${e.round}] MODERATOR: ${e.content}`;
      case "scenario_change":
        return `[round ${e.round}] SCENARIO CHANGE: ${e.new_prompt}`;
      case "cooldown":
        return `COOLDOWN: ${e.seat_id} for ${e.rounds} rounds (${e.reason})`;
    }
  });
  return `New events since your last turn:\n${lines.join("\n")}\n\nIt's your turn. Respond in character.`;
}

function formatBuzzCheckPrompt(recentTurns: TurnEvent[], nonce: string): string {
  const recent = recentTurns
    .filter((e): e is Extract<TurnEvent, { kind: "turn" }> => e.kind === "turn")
    .slice(-3)
    .map((e) => `${e.speaker}: ${e.content}`)
    .join("\n");
  return [
    "Buzz check. Do you want to speak next?",
    recent ? `Recent turns:\n${recent}` : "",
    `Echo this nonce in your tool call: ${nonce}`,
    "Call `buzzer.press({ intensity, intent, nonce })` if you want to speak,",
    "or `buzzer.pass({ reason, nonce })` to decline.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function drainAsyncIterable(iter: AsyncIterable<string>): Promise<void> {
  for await (const _ of iter) {
    // discard; the buzz answer comes via MCP tool calls
  }
}

// Re-exports for convenience.
export { RuntimeDisabledError } from "./types.ts";
export type {
  ClaudeCodeRuntimeConfig,
  SessionBrief,
  ClaudeCodeMessage,
} from "./types.ts";
export type { ClaudeCodeTransport } from "./transport.ts";
