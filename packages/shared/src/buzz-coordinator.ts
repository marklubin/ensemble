import { z } from "zod";

/**
 * Contract between the MCP server (Phase 1B) and runtimes calling
 * buzzCheck (Phase 1C, 1D). The MCP server hosts a BuzzCoordinator
 * that the runtime awaits; when the persona's agent calls
 * `buzzer.press` or `buzzer.pass` over MCP, the coordinator resolves
 * the pending promise.
 *
 * Pre-declared in Phase 0 so B and C/D can implement against the same
 * waiter key without coordinating.
 */

/** Identifies a single buzz-check that a runtime is awaiting. */
export const BuzzWaiterKey = z.object({
  session_id: z.string(),
  seat_id: z.string(),
  /** A short opaque value the runtime injects into the prompt so the
   *  agent echoes it back via the buzzer tool args; lets the
   *  coordinator route the resolution even with concurrent polls. */
  nonce: z.string().min(8),
});
export type BuzzWaiterKey = z.infer<typeof BuzzWaiterKey>;

/** Output of a buzz-check, populated by either buzzer.press or buzzer.pass. */
export const BuzzWaiterResolution = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pressed"),
    score: z.number().min(0).max(10),
    intent: z.string(),
  }),
  z.object({
    kind: z.literal("passed"),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("timeout"),
  }),
]);
export type BuzzWaiterResolution = z.infer<typeof BuzzWaiterResolution>;

/** The interface the MCP server exposes for runtimes to use. */
export interface BuzzCoordinator {
  /** Register a waiter; returns a promise that resolves when the
   *  agent calls buzzer.press or buzzer.pass with this nonce. */
  wait(key: BuzzWaiterKey, timeoutMs: number): Promise<BuzzWaiterResolution>;

  /** Cancel a waiter explicitly (e.g., runtime tore down). */
  cancel(key: BuzzWaiterKey): void;
}
