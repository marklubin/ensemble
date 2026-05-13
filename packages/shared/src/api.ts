import { z } from "zod";

/**
 * The Host API — MCP tools Ensemble serves per-session. Runtimes call
 * these as standard tools from inside their own agent loops.
 *
 * Each tool has a Zod input schema; output shapes are documented in the
 * server implementation that handles the call.
 */

// ─── Turn signaling ──────────────────────────────────────────────────

export const BuzzerPressInput = z.object({
  intensity: z.number().min(0).max(10),
  intent: z.string().min(1).describe("one sentence: what you'd contribute"),
  /**
   * Buzz-check nonce echoed back from the prompt. The runtime injected
   * this verbatim into the buzz-check instruction; the BuzzCoordinator
   * uses (session_id, seat_id, nonce) to route the resolution.
   *
   * Optional only for tolerance with older runtimes that embedded the
   * nonce as a `#nonce:XXX` suffix in `intent`. New runtimes MUST pass
   * the structured field.
   */
  nonce: z.string().min(8).optional(),
});
export type BuzzerPressInput = z.infer<typeof BuzzerPressInput>;

export const BuzzerPassInput = z.object({
  reason: z.string().optional(),
  /** See `BuzzerPressInput.nonce`. */
  nonce: z.string().min(8).optional(),
});
export type BuzzerPassInput = z.infer<typeof BuzzerPassInput>;

// ─── Memory (session-scoped; store lives on Ensemble's side) ─────────

export const MemoryReadInput = z.object({ key: z.string().min(1) });
export type MemoryReadInput = z.infer<typeof MemoryReadInput>;

export const MemoryWriteInput = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});
export type MemoryWriteInput = z.infer<typeof MemoryWriteInput>;

export const MemoryListInput = z.object({});
export type MemoryListInput = z.infer<typeof MemoryListInput>;

// ─── Session metadata ────────────────────────────────────────────────

export const CastListInput = z.object({});
export type CastListInput = z.infer<typeof CastListInput>;

export const RoundInfoInput = z.object({});
export type RoundInfoInput = z.infer<typeof RoundInfoInput>;

// ─── Moderator (privileged; gated by token claim) ────────────────────

export const ModForceSpeakerInput = z.object({ seat_id: z.string().min(1) });
export type ModForceSpeakerInput = z.infer<typeof ModForceSpeakerInput>;

export const ModCooldownInput = z.object({
  seat_id: z.string().min(1),
  rounds: z.number().int().min(1),
  reason: z.string(),
});
export type ModCooldownInput = z.infer<typeof ModCooldownInput>;

export const ModBypassInput = z.object({
  seat_id: z.string().min(1),
  reason: z.string(),
});
export type ModBypassInput = z.infer<typeof ModBypassInput>;

export const ModInjectInput = z.object({});
export type ModInjectInput = z.infer<typeof ModInjectInput>;

// ─── Tool registry (consumed by the MCP server) ──────────────────────

export const HOST_API_TOOLS = {
  "buzzer.press": {
    description:
      "Signal you want to speak. Used in buzz-check responses and as " +
      "an out-of-turn interjection request.",
    input: BuzzerPressInput,
  },
  "buzzer.pass": {
    description: "Decline this turn entirely. You're skipped this round.",
    input: BuzzerPassInput,
  },
  "memory.read": {
    description: "Read a key from your session-scoped memory.",
    input: MemoryReadInput,
  },
  "memory.write": {
    description: "Persist a key/value to your session-scoped memory.",
    input: MemoryWriteInput,
  },
  "memory.list": {
    description: "List keys in your session-scoped memory.",
    input: MemoryListInput,
  },
  "cast.list": {
    description: "List the cast in this session with roles.",
    input: CastListInput,
  },
  "round.info": {
    description:
      "Current round metadata: round number, turn-taking mode, " +
      "your cooldown status.",
    input: RoundInfoInput,
  },
  "moderator.force_speaker": {
    description: "(Moderator only) Force a seat to speak next.",
    input: ModForceSpeakerInput,
    requires_claim: "moderator",
  },
  "moderator.cooldown": {
    description: "(Moderator only) Put a seat on cooldown for N rounds.",
    input: ModCooldownInput,
    requires_claim: "moderator",
  },
  "moderator.bypass": {
    description: "(Moderator only) Skip a seat this round.",
    input: ModBypassInput,
    requires_claim: "moderator",
  },
  "moderator.inject": {
    description: "(Moderator only) Speak now, ahead of the queue.",
    input: ModInjectInput,
    requires_claim: "moderator",
  },
} as const;

export type HostApiToolName = keyof typeof HOST_API_TOOLS;
