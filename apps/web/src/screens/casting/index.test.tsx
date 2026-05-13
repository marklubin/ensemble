import "../../../test/setup-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { CastingScreen } from "./index.tsx";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function renderWith(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/casting" element={<CastingScreen />} />
        <Route path="/session/:id" element={<div data-testid="session-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CastingScreen smoke", () => {
  test("loads the Debate template, shows constraints, blocks submit until valid", async () => {
    renderWith("/casting?template=debate");

    await waitFor(() => {
      expect(screen.getByTestId("cast-seats")).toBeTruthy();
    });

    // Constraints panel mentions Pro and Con
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Pro/);
    expect(body).toMatch(/Con/);

    // Submit is initially disabled (scenario empty, personas unset)
    const submit = screen.getByTestId("cast-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  test("missing template id shows the not-found path", async () => {
    renderWith("/casting");
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Template not found/i);
    });
  });
});
