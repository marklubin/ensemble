import { z } from "zod";

export const SeatInfo = z.object({
  seat_id: z.string(),
  persona_id: z.string(),
  persona_name: z.string(),
  role: z.string().optional(),
  runtime_type: z.string(),
});
export type SeatInfo = z.infer<typeof SeatInfo>;

export const TurnTakingMode = z.enum([
  "round-robin",
  "shuffled",
  "host-driven",
  "poll",
]);
export type TurnTakingMode = z.infer<typeof TurnTakingMode>;

export const ScenarioFormat = z.enum([
  "motion",
  "question",
  "scenario",
  "document",
  "open",
]);
export type ScenarioFormat = z.infer<typeof ScenarioFormat>;

export const SessionContext = z.object({
  session_id: z.string(),
  seat_id: z.string(),
  scenario: z.string(),
  scenario_format: ScenarioFormat,
  cast: z.array(SeatInfo),
  /** MCP URL the runtime can hit to call Host API tools */
  ensemble_mcp_url: z.string().url(),
  /** Token scoped to (session, seat). Encodes tool permissions. */
  ensemble_mcp_token: z.string(),
});
export type SessionContext = z.infer<typeof SessionContext>;
