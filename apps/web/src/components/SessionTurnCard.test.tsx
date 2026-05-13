import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionTurnCard } from "./SessionTurnCard.tsx";

afterEach(cleanup);

const TS = "2026-05-12T13:48:00.000Z";

describe("<SessionTurnCard>", () => {
  test("renders speaker name and text", () => {
    render(
      <SessionTurnCard
        turn={{
          turn_id: "t1",
          seat_id: "a",
          speaker: "Alex Chen",
          round: 1,
          text: "Hello world.",
          status: "complete",
          timestamp: TS,
        }}
        colorIndex={0}
        role="Tech-optimist"
      />,
    );
    expect(screen.getByText("Alex Chen")).toBeTruthy();
    expect(screen.getByText("Hello world.")).toBeTruthy();
  });

  test("shows blinking cursor while streaming", () => {
    const { container } = render(
      <SessionTurnCard
        turn={{
          turn_id: "t1",
          seat_id: "a",
          speaker: "Jordan",
          round: 1,
          text: "Partial…",
          status: "streaming",
          timestamp: TS,
        }}
        colorIndex={1}
      />,
    );
    expect(container.querySelector(".session-cursor")).toBeTruthy();
    expect(container.querySelector(".session-lines.streaming")).toBeTruthy();
  });

  test("no cursor when complete", () => {
    const { container } = render(
      <SessionTurnCard
        turn={{
          turn_id: "t1",
          seat_id: "a",
          speaker: "Jordan",
          round: 1,
          text: "Done.",
          status: "complete",
          timestamp: TS,
        }}
        colorIndex={1}
      />,
    );
    expect(container.querySelector(".session-cursor")).toBeNull();
  });

  test("uses human color class when isHuman is set", () => {
    const { container } = render(
      <SessionTurnCard
        turn={{
          turn_id: "t1",
          seat_id: "human",
          speaker: "Mark",
          round: 1,
          text: "Hey.",
          status: "complete",
          timestamp: TS,
        }}
        colorIndex={0}
        isHuman
      />,
    );
    expect(container.querySelector(".session-speaker.human")).toBeTruthy();
  });

  test("renders multiple paragraphs split on blank lines", () => {
    render(
      <SessionTurnCard
        turn={{
          turn_id: "t1",
          seat_id: "a",
          speaker: "A",
          round: 1,
          text: "First.\n\nSecond.",
          status: "complete",
          timestamp: TS,
        }}
        colorIndex={0}
      />,
    );
    expect(screen.getByText("First.")).toBeTruthy();
    expect(screen.getByText("Second.")).toBeTruthy();
  });
});
