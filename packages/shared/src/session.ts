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
  /** Soft target for response length per turn in words. Plumbed into the
   *  persona's system prompt. Optional for back-compat with older callers. */
  target_words_per_turn: z.number().int().min(20).max(600).optional(),
});
export type SessionContext = z.infer<typeof SessionContext>;

/**
 * Session length — `open-ended` runs until `end()` is called.
 * `n_rounds=N` runs N rounds and then ends with `n-rounds-reached`.
 *
 * Promoted to @ensemble/shared in v1.0.0 from
 * apps/server/src/scheduler/index.ts so server + web agree.
 */
export const SessionLength = z.union([
  z.object({ kind: z.literal("open-ended") }),
  z.object({ kind: z.literal("n_rounds"), n: z.number().int().min(1) }),
]);
export type SessionLength = z.infer<typeof SessionLength>;

/**
 * POST /sessions request body. Shared between server route validation
 * and the web client. Promoted in v1.0.0 from local copies on both
 * sides per Phase 3 outstanding work.
 */
export const CreateSessionRequest = z.object({
  template_id: z.string().min(1),
  scenario: z.string().min(1),
  scenario_format: ScenarioFormat.default("open"),
  cast: z.array(SeatInfo).min(1),
  turn_taking_mode: TurnTakingMode,
  length: SessionLength.default({ kind: "open-ended" }),
  cooldown_rounds: z.number().int().min(0).default(1),
  host_seat_id: z.string().optional(),
  /**
   * Soft target for response length per turn, in words. Plumbed into
   * each persona's system prompt as "Keep responses to about N words".
   * Default 120 ≈ 3 short paragraphs; floor 20, ceiling 600.
   */
  target_words_per_turn: z.number().int().min(20).max(600).default(120),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

/**
 * GET /sessions/:id response shape. Consumed by the web session screen
 * and produced by the server's session route. Promoted from Agent G's
 * local declaration in apps/web/src/screens/session/index.tsx.
 */
export const SessionMeta = z.object({
  session_id: z.string(),
  template: z.string(),
  scenario: z.string(),
  scenario_format: ScenarioFormat,
  rounds_planned: z.number().int().nonnegative(),
  cast: z.array(SeatInfo),
  human_seat_id: z.string().nullable(),
  turn_taking: TurnTakingMode,
  started_at: z.string().nullable(),
  cost_so_far_usd: z.number().nonnegative(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

/**
 * Moderator action emitted by the UI's moderator card; consumed by the
 * server's `POST /sessions/:id/moderator/:tool` proxy.
 *
 * Promoted from apps/web/src/components/SessionModeratorCard.tsx.
 */
export const ModeratorAction = z.object({
  tool: z.enum(["force_speaker", "cooldown", "bypass", "inject"]),
  args: z.record(z.unknown()),
});
export type ModeratorAction = z.infer<typeof ModeratorAction>;
