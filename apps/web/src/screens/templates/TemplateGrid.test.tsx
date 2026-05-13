import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Template } from "@ensemble/shared";
import { TemplateGrid } from "./TemplateGrid.tsx";

const SAMPLE: Template[] = [
  {
    id: "debate",
    name: "Debate",
    description: "Two sides, a moderator.",
    min_cast: 2,
    max_cast: 6,
    required_roles: [
      { role: "Pro", min: 1 },
      { role: "Con", min: 1 },
    ],
    turn_taking_mode: "shuffled",
    cooldown_rounds: 1,
    moderator_present: true,
    moderator_role: "judge",
    moderator_cadence: "every-round",
    moderator_tools: ["web_search"],
    scenario_format: "motion",
    default_rounds: 3,
    conclusion_synthesis: "verdict-with-winner",
    conclusion_scoring: true,
    human_default_seat: "spectator",
  },
  {
    id: "roundtable",
    name: "Roundtable",
    description: "Equal voices.",
    min_cast: 2,
    max_cast: 6,
    required_roles: [],
    turn_taking_mode: "shuffled",
    cooldown_rounds: 1,
    moderator_present: false,
    moderator_tools: [],
    scenario_format: "open",
    conclusion_synthesis: "summary",
    conclusion_scoring: false,
    human_default_seat: "participant",
  },
];

describe("TemplateGrid snapshots", () => {
  test("loading state renders two skeletons", () => {
    const html = renderToStaticMarkup(
      <TemplateGrid
        templates={[]}
        loading={true}
        onSelect={() => {}}
        onUse={() => {}}
      />,
    );
    expect(html).toMatchSnapshot();
    expect(html).toContain('data-state="loading"');
    expect(html.match(/data-testid="template-skeleton"/g)?.length).toBe(2);
  });

  test("empty state shows a friendly hint", () => {
    const html = renderToStaticMarkup(
      <TemplateGrid
        templates={[]}
        loading={false}
        onSelect={() => {}}
        onUse={() => {}}
      />,
    );
    expect(html).toMatchSnapshot();
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No templates available yet");
  });

  test("populated state lists every template card with use button", () => {
    const html = renderToStaticMarkup(
      <TemplateGrid
        templates={SAMPLE}
        loading={false}
        selectedId="debate"
        onSelect={() => {}}
        onUse={() => {}}
        pastCounts={{ debate: 12, roundtable: 3 }}
      />,
    );
    expect(html).toMatchSnapshot();
    expect(html).toContain('data-template-id="debate"');
    expect(html).toContain('data-template-id="roundtable"');
    expect(html).toContain('data-testid="use-debate"');
    expect(html).toContain('data-testid="use-roundtable"');
    expect(html).toContain("12 past debates");
    expect(html).toContain("3 past roundtables");
    // Selected card carries the marker class
    expect(html).toMatch(/class="tp-card is-selected"[^>]*data-template-id="debate"/);
  });
});
