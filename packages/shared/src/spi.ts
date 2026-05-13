import { z } from "zod";
import type { PersonaSpec } from "./persona.ts";
import type { SessionContext } from "./session.ts";
import type { TurnEvent, BuzzResponse } from "./events.ts";

/**
 * Capabilities a runtime instance declares at attach time.
 * Sessions requesting a capability the runtime doesn't have either
 * degrade gracefully or refuse to cast that runtime.
 */
export const Capability = z.enum([
  "streaming",          // produces an async string stream
  "buzz_check",         // supports programmatic buzz checks
  "tools",              // honors tools_allowed
  "mcp",                // can call MCP servers
  "memory_inspection",  // exposes its memory to Ensemble
  "pause_resume",       // can be paused cheaply
]);
export type Capability = z.infer<typeof Capability>;

export interface InstanceHandle {
  readonly id: string;
  readonly seat_id: string;
  readonly capabilities: ReadonlySet<Capability>;
}

/**
 * The Service Provider Interface every runtime adapter implements.
 * Ensemble calls into this; the runtime owns the chat loop, tool
 * dispatch, streaming, and conversation state.
 */
export interface PersonaRuntime {
  /** Stable identifier: "managed-agents" | "claude-code" | "human" | ... */
  readonly name: string;

  /** Default capability set for this runtime class. Per-instance set returned by attach may differ. */
  readonly defaultCapabilities: ReadonlySet<Capability>;

  /** Provision an instance of this persona in the runtime. */
  attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle>;

  /**
   * The instance's turn has come. `newEvents` are events the runtime
   * hasn't seen yet. Yields response chunks as the runtime streams them.
   */
  takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string>;

  /**
   * Poll-mode self-select. Required if the session uses `poll` mode
   * (capability-gated by `buzz_check`).
   */
  buzzCheck(
    handle: InstanceHandle,
    recentTurns: TurnEvent[],
  ): Promise<BuzzResponse>;

  /** Clean up the instance at session end. */
  detach(handle: InstanceHandle): Promise<void>;

  // ─── Optional, capability-gated ────────────────────────────────────

  /** Inspect the persona's runtime-held memory. Requires `memory_inspection`. */
  inspectMemory?(handle: InstanceHandle): Promise<Record<string, unknown>>;

  /** Pause an idle instance (cost/container lifecycle). Requires `pause_resume`. */
  pause?(handle: InstanceHandle): Promise<void>;
  resume?(handle: InstanceHandle): Promise<void>;
}
