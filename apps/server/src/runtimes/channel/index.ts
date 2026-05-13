/**
 * ChannelRuntime — Claude Code via channels.
 *
 * Unlike the v1.5 `ClaudeCodeRuntime` + `LocalCliTransport` that spawns
 * `claude -p` per turn, this runtime assumes an externally-managed
 * Claude Code session is already running with our channel-bridge MCP
 * server attached. Ensemble drives turns by handing prompts to the
 * `ChannelCoordinator`, which forwards them to the bridge over a
 * WebSocket. The bridge pushes them into the running Claude session
 * via `notifications/claude/channel`, and the persona's agent calls
 * back into a `reply` tool exposed by the bridge — the bridge
 * forwards those calls back over the WS as `reply` frames.
 *
 * `attach` does NOT spawn anything. It registers an expectation that
 * a channel will appear for (session_id, seat_id). If `takeTurn` /
 * `buzzCheck` are called before a channel connects, they throw a
 * typed `ChannelNotConnectedError`. Operators are expected to keep
 * the Claude session running before the scheduler starts.
 *
 * Capabilities: streaming, buzz_check, tools, mcp.
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

import {
  ChannelNotConnectedError,
  type ChannelCoordinator,
  type ReplyChunk,
} from "../../channels/coordinator.ts";
import { logger } from "../../logging/index.ts";

const DEFAULT_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "streaming",
  "buzz_check",
  "tools",
  "mcp",
] satisfies Capability[]);

const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const DEFAULT_BUZZ_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_WAIT_MS = 30_000;

export interface ChannelRuntimeConfig {
  /** Master switch — registry only wires the runtime in when this is true. */
  enabled: boolean;
  /** Per-turn timeout for a dispatched prompt. Default 60s. */
  turnTimeoutMs?: number;
  /** Per-buzz-check timeout for the buzzer.* MCP call. Default 10s. */
  buzzCheckTimeoutMs?: number;
  /**
   * How long `attach` will wait for an externally-launched bridge to
   * register before resolving. Default 30s. Resolves either way; if
   * the channel doesn't appear, subsequent `takeTurn` / `buzzCheck`
   * calls will throw `ChannelNotConnectedError` informatively.
   *
   * Set to 0 to skip waiting (useful in tests where the bridge will
   * connect before any turn is taken).
   */
  attachConnectWaitMs?: number;
}

interface InternalSession {
  ctx: SessionContext;
  persona: PersonaSpec;
}

function handleId(sessionId: string, seatId: string): string {
  return `channel:${sessionId}:${seatId}`;
}

function parseHandleId(id: string): { sessionId: string; seatId: string } {
  const m = /^channel:(.+?):(.+)$/.exec(id);
  if (!m) throw new Error(`malformed channel handle id: ${id}`);
  return { sessionId: m[1]!, seatId: m[2]! };
}

export class ChannelRuntime implements PersonaRuntime {
  readonly name = "claude-code";
  readonly defaultCapabilities: ReadonlySet<Capability> = DEFAULT_CAPABILITIES;

  private readonly sessions = new Map<string, InternalSession>();

  constructor(
    private readonly coordinator: ChannelCoordinator,
    private readonly buzzCoordinator: BuzzCoordinator,
    private readonly config: ChannelRuntimeConfig,
  ) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    if (!this.config.enabled) {
      throw new Error("ChannelRuntime is not configured (enabled=false)");
    }

    const id = handleId(ctx.session_id, ctx.seat_id);
    this.sessions.set(id, { ctx, persona });

    logger.info("channel.attach.start", {
      session_id: ctx.session_id,
      seat_id: ctx.seat_id,
      persona_id: persona.id,
      handle_id: id,
      already_connected: this.coordinator.isConnected(
        ctx.session_id,
        ctx.seat_id,
      ),
    });

    // Wait a short period for the bridge to appear if it hasn't yet.
    // Polling is fine: registration is rare and the wait window is
    // bounded.
    const waitMs = this.config.attachConnectWaitMs ?? DEFAULT_CONNECT_WAIT_MS;
    if (waitMs > 0 && !this.coordinator.isConnected(ctx.session_id, ctx.seat_id)) {
      await waitForConnection(this.coordinator, ctx.session_id, ctx.seat_id, waitMs);
    }

    logger.info("channel.attach.ok", {
      session_id: ctx.session_id,
      seat_id: ctx.seat_id,
      handle_id: id,
      connected: this.coordinator.isConnected(
        ctx.session_id,
        ctx.seat_id,
      ),
    });

    return {
      id,
      seat_id: ctx.seat_id,
      capabilities: this.defaultCapabilities,
    };
  }

  takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string> {
    const session = this.requireSession(handle);
    const { sessionId, seatId } = parseHandleId(handle.id);
    const prompt = formatEventsAsTurnPrompt(newEvents);

    const timeoutMs = this.config.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    const turnId = this.coordinator.nextTurnId();
    const meta: Record<string, unknown> = {
      ensemble_session: sessionId,
      ensemble_seat: seatId,
      ensemble_persona: session.persona.name,
      kind: "turn",
    };
    logger.info("channel.send", {
      session_id: sessionId,
      seat_id: seatId,
      turn_id: turnId,
      prompt_length: prompt.length,
    });
    const replies = this.coordinator.sendTurnPrompt(
      sessionId,
      seatId,
      prompt,
      turnId,
      meta,
      timeoutMs,
    );

    return mapReplies(replies, sessionId, seatId, turnId);
  }

  async buzzCheck(
    handle: InstanceHandle,
    recentTurns: TurnEvent[],
  ): Promise<BuzzResponse> {
    const session = this.requireSession(handle);
    const { sessionId, seatId } = parseHandleId(handle.id);
    const nonce = generateNonce();

    const buzzTimeoutMs =
      this.config.buzzCheckTimeoutMs ?? DEFAULT_BUZZ_TIMEOUT_MS;
    const waiterKey: BuzzWaiterKey = { session_id: sessionId, seat_id: seatId, nonce };
    const waiter = this.buzzCoordinator.wait(waiterKey, buzzTimeoutMs);

    const prompt = formatBuzzCheckPrompt(recentTurns, nonce);
    const meta = {
      ensemble_session: sessionId,
      ensemble_seat: seatId,
      ensemble_persona: session.persona.name,
      kind: "buzz_check",
      nonce,
    };

    // Dispatch the prompt; we drain the replies (which are usually just
    // ack chunks — the actual answer comes via `buzzer.press`/`pass`).
    let replies: AsyncIterable<ReplyChunk>;
    try {
      replies = this.coordinator.sendTurnPrompt(
        sessionId,
        seatId,
        prompt,
        this.coordinator.nextTurnId(),
        meta,
        buzzTimeoutMs,
      );
    } catch (err) {
      this.buzzCoordinator.cancel(waiterKey);
      throw err;
    }

    const drain = drainReplies(replies).catch(() => {});

    try {
      const resolution = await waiter;
      await drain;
      if (resolution.kind === "pressed") {
        return { score: resolution.score, intent: resolution.intent, can_pass: true };
      }
      if (resolution.kind === "passed") {
        return { score: 0, intent: resolution.reason ?? "", can_pass: true };
      }
      return { score: 0, intent: "", can_pass: true };
    } catch (err) {
      this.buzzCoordinator.cancel(waiterKey);
      await drain;
      throw err;
    }
  }

  async detach(handle: InstanceHandle): Promise<void> {
    if (!this.sessions.has(handle.id)) return;
    try {
      const { sessionId, seatId } = parseHandleId(handle.id);
      this.coordinator.unregister(sessionId, seatId, "detached");
    } finally {
      this.sessions.delete(handle.id);
    }
  }

  private requireSession(handle: InstanceHandle): InternalSession {
    const s = this.sessions.get(handle.id);
    if (!s) {
      throw new Error(
        `ChannelRuntime: unknown handle id ${handle.id} (seat ${handle.seat_id}); was attach called?`,
      );
    }
    return s;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

async function* mapReplies(
  iter: AsyncIterable<ReplyChunk>,
  sessionId?: string,
  seatId?: string,
  turnId?: string,
): AsyncIterable<string> {
  let totalLen = 0;
  let chunkCount = 0;
  try {
    for await (const r of iter) {
      if (r.content.length > 0) {
        totalLen += r.content.length;
        chunkCount += 1;
        yield r.content;
      }
    }
  } finally {
    if (sessionId && seatId && turnId) {
      logger.info("channel.receive_complete", {
        session_id: sessionId,
        seat_id: seatId,
        turn_id: turnId,
        total_length: totalLen,
        chunk_count: chunkCount,
      });
    }
  }
}

async function drainReplies(iter: AsyncIterable<ReplyChunk>): Promise<void> {
  for await (const _ of iter) {
    // discard
  }
}

function generateNonce(): string {
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

async function waitForConnection(
  coordinator: ChannelCoordinator,
  sessionId: string,
  seatId: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  // Poll every 100ms. Acceptable for a 30s connect window.
  const tick = 100;
  while (Date.now() - start < timeoutMs) {
    if (coordinator.isConnected(sessionId, seatId)) return;
    await new Promise((res) => setTimeout(res, tick));
  }
  // No throw — runtime will surface the typed error on first dispatch.
}

export { ChannelNotConnectedError } from "../../channels/coordinator.ts";
