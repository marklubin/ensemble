import { Hono } from "hono";
import { Template } from "@ensemble/shared";

/**
 * Static template catalogue. v1 ships two presets. Schema is
 * intentionally hardcoded here — templates are session-configuration
 * presets, not user content, so they live in code.
 */
const V1_TEMPLATES = [
  {
    id: "debate",
    name: "Debate",
    description:
      "Two sides, a moderator who checks the work, and rounds that build toward a verdict.",
    min_cast: 2,
    max_cast: 6,
    required_roles: [
      { role: "Pro", min: 1 },
      { role: "Con", min: 1 },
    ],
    turn_taking_mode: "shuffled" as const,
    cooldown_rounds: 1,
    moderator_present: true,
    moderator_role: "judge" as const,
    moderator_cadence: "every-round" as const,
    moderator_tools: ["web_search"],
    scenario_format: "motion" as const,
    default_rounds: 3,
    conclusion_synthesis: "verdict-with-winner" as const,
    conclusion_scoring: true,
    human_default_seat: "spectator" as const,
  },
  {
    id: "roundtable",
    name: "Roundtable",
    description:
      "Equal voices, shuffled order, no moderator unless you want one. The original sim.py model.",
    min_cast: 2,
    max_cast: 6,
    required_roles: [],
    turn_taking_mode: "shuffled" as const,
    cooldown_rounds: 1,
    moderator_present: false,
    moderator_tools: [],
    scenario_format: "open" as const,
    conclusion_synthesis: "summary" as const,
    conclusion_scoring: false,
    human_default_seat: "participant" as const,
  },
];

// Validate at module load so a schema drift surfaces at boot.
const TEMPLATES: ReadonlyArray<ReturnType<typeof Template.parse>> =
  V1_TEMPLATES.map((t) => Template.parse(t));

export function createTemplateRoutes(): Hono {
  const r = new Hono();
  r.get("/", (c) => c.json(TEMPLATES));
  r.get("/:id", (c) => {
    const t = TEMPLATES.find((x) => x.id === c.req.param("id"));
    if (!t) return c.json({ error: "not_found" }, 404);
    return c.json(t);
  });
  return r;
}

/** For tests. */
export const _V1_TEMPLATES = TEMPLATES;
