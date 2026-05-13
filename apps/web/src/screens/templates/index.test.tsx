import "../../../test/setup-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryRouter } from "react-router-dom";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { TemplatesScreen } from "./index.tsx";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Force the api-client into mock mode.
  globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("TemplatesScreen smoke", () => {
  test("renders the lead heading, the two default templates, and the persona hint", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TemplatesScreen />
      </MemoryRouter>,
    );

    // Lead
    expect(
      screen.getByText(/Who's at the table/i, { exact: false }),
    ).toBeTruthy();

    // Wait for the mock templates to load.
    await waitFor(() => {
      expect(screen.getByTestId("template-card-debate")).toBeTruthy();
    });
    expect(screen.getByTestId("template-card-roundtable")).toBeTruthy();
    expect(screen.getByTestId("use-debate")).toBeTruthy();
    expect(screen.getByTestId("use-roundtable")).toBeTruthy();

    // Persona hint reflects the mock count (3-4 default personas).
    const hintCount = document.querySelector(".tp-persona-hint .count");
    expect(hintCount).toBeTruthy();
    expect(parseInt(hintCount!.textContent ?? "0", 10)).toBeGreaterThanOrEqual(3);
  });
});
