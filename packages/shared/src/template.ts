import { z } from "zod";
import { TurnTakingMode, ScenarioFormat } from "./session.ts";

/**
 * Templates are named presets in the session configuration space
 * described in ~/ensemble/dimensions.md. Same engine underneath; the
 * template pins specific values on most axes.
 *
 * v1 ships two templates: Debate and Roundtable. The schema accepts
 * future templates without code changes.
 */

export const ModerationCadence = z.enum([
  "every-round",
  "on-demand",
  "start-and-end-only",
  "between-phases",
  "continuous",
]);
export type ModerationCadence = z.infer<typeof ModerationCadence>;

export const ConclusionSynthesis = z.enum([
  "none",
  "summary",
  "verdict-with-winner",
  "deal-terms",
  "action-items",
  "score-card",
]);
export type ConclusionSynthesis = z.infer<typeof ConclusionSynthesis>;

/** Constraint on cast composition (e.g., Debate needs Pro and Con seats). */
export const RoleRequirement = z.object({
  role: z.string(),
  min: z.number().int().min(0).default(0),
  max: z.number().int().min(1).optional(),
});

export const Template = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),

  // ─── Cast constraints ───────────────────────────────────────────────
  min_cast: z.number().int().min(1).default(2),
  max_cast: z.number().int().min(1).optional(),
  required_roles: z.array(RoleRequirement).default([]),

  // ─── Turn-taking ────────────────────────────────────────────────────
  turn_taking_mode: TurnTakingMode,
  cooldown_rounds: z.number().int().min(0).default(1),

  // ─── Moderation ─────────────────────────────────────────────────────
  moderator_present: z.boolean().default(false),
  moderator_role: z
    .enum(["fact-checker", "host", "mediator", "judge", "director", "narrator"])
    .optional(),
  moderator_cadence: ModerationCadence.optional(),
  moderator_tools: z.array(z.string()).default([]),

  // ─── Scenario / structure ──────────────────────────────────────────
  scenario_format: ScenarioFormat,
  default_rounds: z.number().int().min(1).optional(),

  // ─── Conclusion ─────────────────────────────────────────────────────
  conclusion_synthesis: ConclusionSynthesis.default("summary"),
  conclusion_scoring: z.boolean().default(false),

  // ─── Human role default ─────────────────────────────────────────────
  human_default_seat: z
    .enum(["spectator", "participant"])
    .default("participant"),
});
export type Template = z.infer<typeof Template>;
