import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionQueueChip } from "./SessionQueueChip.tsx";

afterEach(cleanup);

describe("<SessionQueueChip>", () => {
  test.each(["done", "current", "upcoming", "bypassed"] as const)(
    "renders state %s",
    (state) => {
      render(<SessionQueueChip label="Alex" state={state} />);
      const chip = screen.getByText("Alex");
      expect(chip.getAttribute("data-state")).toBe(state);
      expect(chip.className).toContain(state);
    },
  );
});
