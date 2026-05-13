import { z } from "zod";

/** Events the scheduler emits and replays. Runtimes receive these via takeTurn. */
export const TurnEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("turn"),
    seat_id: z.string(),
    speaker: z.string(),
    content: z.string(),
    round: z.number().int(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("moderator"),
    content: z.string(),
    round: z.number().int(),
    tool_calls: z
      .array(
        z.object({
          tool: z.string(),
          args: z.unknown(),
          result: z.unknown(),
        }),
      )
      .optional(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("scenario_change"),
    new_prompt: z.string(),
    round: z.number().int(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("cooldown"),
    seat_id: z.string(),
    rounds: z.number().int(),
    reason: z.string(),
    timestamp: z.string().datetime(),
  }),
]);
export type TurnEvent = z.infer<typeof TurnEvent>;

/** Returned by buzzCheck. */
export const BuzzResponse = z.object({
  score: z.number().min(0).max(10),
  intent: z.string(),
  can_pass: z.boolean().default(true),
});
export type BuzzResponse = z.infer<typeof BuzzResponse>;
