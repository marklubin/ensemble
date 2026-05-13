import { z } from "zod";

/**
 * Wire protocol between the HumanRuntime (server, Phase 1E) and the
 * in-session UX (web client, Phase 1G).
 *
 * Pre-declared in Phase 0 so both agents can implement against the
 * same shape without coordinating during the parallel phase.
 *
 * Transport: HTTP POST (client → server) with newline-delimited JSON
 * messages of this shape. The server bridges these into the
 * AsyncIterable<string> that HumanRuntime.takeTurn yields.
 */
export const UiBridgeMessage = z.discriminatedUnion("kind", [
  /** Server tells the client which seat should focus its textarea. */
  z.object({
    kind: z.literal("focus"),
    seat_id: z.string(),
    turn_id: z.string(),
  }),
  /** Client streams a chunk of characters as the human types. */
  z.object({
    kind: z.literal("chunk"),
    seat_id: z.string(),
    turn_id: z.string(),
    text: z.string(),
  }),
  /** Client signals end of turn (user hit Submit). */
  z.object({
    kind: z.literal("submit"),
    seat_id: z.string(),
    turn_id: z.string(),
  }),
  /** Client cancels mid-turn (user navigated away, etc.). */
  z.object({
    kind: z.literal("cancel"),
    seat_id: z.string(),
    turn_id: z.string(),
    reason: z.string().optional(),
  }),
  /** Server tells the client to release focus (turn ended on the server). */
  z.object({
    kind: z.literal("blur"),
    seat_id: z.string(),
    turn_id: z.string(),
  }),
]);
export type UiBridgeMessage = z.infer<typeof UiBridgeMessage>;
