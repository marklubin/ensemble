/**
 * Local types for the Claude Code runtime.
 *
 * These are intentionally local (not in @ensemble/shared) — the
 * `ClaudeCodeTransport` is an internal seam between the runtime and the
 * transport implementations (mock or local CLI). The SPI surface
 * (PersonaRuntime) is what the rest of the system depends on.
 *
 * If anything here ends up being reused across runtimes, surface it for
 * promotion in HANDOFF.md.
 */

import type { PersonaSpec } from "@ensemble/shared/persona";
import type { SeatInfo } from "@ensemble/shared/session";
import type { TurnEvent } from "@ensemble/shared/events";

/**
 * Sent to the Claude Code transport at attach time. Contains everything
 * the running Claude Code session needs to behave as a seat: persona
 * spec (system prompt, role, voice, buzz-in policy), scenario, the
 * other cast members, and the MCP URL + token to reach Ensemble's
 * Host API tools.
 */
export interface SessionBrief {
  ensemble_session_id: string;
  seat_id: string;
  persona: PersonaSpec;
  scenario: string;
  scenario_format: string;
  cast: SeatInfo[];
  ensemble_mcp_url: string;
  ensemble_mcp_token: string;
}

/**
 * Wire messages sent from the runtime to the transport over an
 * established session. Discriminated on `kind`. The transport returns
 * an async iterable of string chunks; end-of-turn is signalled by the
 * iterable completing.
 */
export type ClaudeCodeMessage =
  | TurnMessage
  | BuzzCheckMessage;

export interface TurnMessage {
  kind: "turn";
  /** Pre-formatted prompt describing the new events the seat hasn't
   *  seen yet (formatted by the runtime, not by the transport). */
  prompt: string;
  /** Raw events for transports that prefer structured input. */
  events: TurnEvent[];
}

export interface BuzzCheckMessage {
  kind: "buzz_check";
  /** Pre-formatted buzz-check prompt. */
  prompt: string;
  /** Nonce the agent must echo through `buzzer.press` / `buzzer.pass`
   *  so the BuzzCoordinator can route the resolution. */
  nonce: string;
  recentTurns: TurnEvent[];
}

/** Raised when a caller tries to attach but the feature flag is off. */
export class RuntimeDisabledError extends Error {
  constructor(message = "Claude Code runtime is not configured") {
    super(message);
    this.name = "RuntimeDisabledError";
  }
}

/** Configuration accepted by the runtime constructor. */
export interface ClaudeCodeRuntimeConfig {
  /** Master switch. The registry only wires the runtime in when this is true. */
  enabled: boolean;
  /** Milliseconds to wait for a buzz-check resolution before timing out. */
  buzzCheckTimeoutMs?: number;
}
