import { z } from "zod";

/**
 * SSE envelope the scheduler emits on GET /sessions/:id/events and the
 * web client consumes. Pre-declared in Phase 0 so A (scheduler) and G
 * (in-session UX) implement against the same shape.
 *
 * Each event is a JSON object serialized as a single SSE `data:` line.
 */
export const SseEvent = z.discriminatedUnion("type", [
  // ─── Session lifecycle ─────────────────────────────────────────────
  z.object({
    type: z.literal("session.start"),
    session_id: z.string(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("session.end"),
    session_id: z.string(),
    ended_by: z.enum(["user", "n-rounds-reached", "moderator"]),
    timestamp: z.string().datetime(),
  }),

  // ─── Round lifecycle ───────────────────────────────────────────────
  z.object({
    type: z.literal("round.start"),
    session_id: z.string(),
    round: z.number().int(),
    order: z.array(z.string()),  // seat_ids in speaking order
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("round.end"),
    session_id: z.string(),
    round: z.number().int(),
    timestamp: z.string().datetime(),
  }),

  // ─── Turn lifecycle ────────────────────────────────────────────────
  z.object({
    type: z.literal("turn.start"),
    session_id: z.string(),
    seat_id: z.string(),
    speaker: z.string(),
    round: z.number().int(),
    turn_id: z.string(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("turn.delta"),
    session_id: z.string(),
    turn_id: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("turn.end"),
    session_id: z.string(),
    turn_id: z.string(),
    seat_id: z.string(),
    full_text: z.string(),
    timestamp: z.string().datetime(),
  }),

  // ─── Moderator + tool activity ─────────────────────────────────────
  z.object({
    type: z.literal("moderator.message"),
    session_id: z.string(),
    round: z.number().int(),
    content: z.string(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("tool.status"),
    session_id: z.string(),
    seat_id: z.string(),
    tool: z.string(),
    status: z.enum(["start", "progress", "complete", "error"]),
    detail: z.string().optional(),
    timestamp: z.string().datetime(),
  }),

  // ─── Cooldowns / bypass ────────────────────────────────────────────
  z.object({
    type: z.literal("cooldown.applied"),
    session_id: z.string(),
    seat_id: z.string(),
    rounds: z.number().int(),
    reason: z.string(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("seat.bypassed"),
    session_id: z.string(),
    seat_id: z.string(),
    round: z.number().int(),
    reason: z.string(),
    timestamp: z.string().datetime(),
  }),
]);
export type SseEvent = z.infer<typeof SseEvent>;
