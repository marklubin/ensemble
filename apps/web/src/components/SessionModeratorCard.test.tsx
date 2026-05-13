import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionModeratorCard, type ModeratorAction } from "./SessionModeratorCard.tsx";
import type { SeatInfo } from "@ensemble/shared";

afterEach(cleanup);

const CAST: SeatInfo[] = [
  { seat_id: "a", persona_id: "p-a", persona_name: "Alex", role: "Pro", runtime_type: "managed-agents" },
  { seat_id: "b", persona_id: "p-b", persona_name: "Jordan", role: "Con", runtime_type: "managed-agents" },
];

const BLOCK = {
  id: "mod-1",
  round: 2,
  content: "Both sides have a point.",
  timestamp: "2026-05-12T13:48:00.000Z",
  tools: [{ tool: "web.search", status: "complete", detail: "2 sources" }],
};

describe("<SessionModeratorCard>", () => {
  test("renders moderator body and tool chip", () => {
    render(<SessionModeratorCard block={BLOCK} cast={CAST} isModerator={false} />);
    expect(screen.getByText("Both sides have a point.")).toBeTruthy();
    expect(screen.getByText(/web\.search/)).toBeTruthy();
  });

  test("hides controls when not moderator", () => {
    render(<SessionModeratorCard block={BLOCK} cast={CAST} isModerator={false} />);
    expect(screen.queryByTestId("session-moderator-controls")).toBeNull();
  });

  test("force_speaker submits seat_id", () => {
    const actions: ModeratorAction[] = [];
    render(
      <SessionModeratorCard
        block={BLOCK}
        cast={CAST}
        isModerator
        onAction={(a) => actions.push(a)}
      />,
    );
    fireEvent.click(screen.getByText("Force speaker"));
    const select = screen.getByLabelText("Force speaker seat") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "b" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(actions).toEqual([{ tool: "force_speaker", args: { seat_id: "b" } }]);
  });

  test("inject submits content", () => {
    const actions: ModeratorAction[] = [];
    render(
      <SessionModeratorCard
        block={BLOCK}
        cast={CAST}
        isModerator
        onAction={(a) => actions.push(a)}
      />,
    );
    fireEvent.click(screen.getByText("Inject"));
    fireEvent.change(screen.getByLabelText("Inject moderator message"), {
      target: { value: "calm down please" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(actions).toEqual([{ tool: "inject", args: { content: "calm down please" } }]);
  });
});
