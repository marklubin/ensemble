import "../../../test/setup-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { PersonasScreen } from "./index.tsx";
import { PersonaEditScreen } from "./edit.tsx";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("PersonasScreen smoke", () => {
  test("renders the library list with default mock personas", async () => {
    render(
      <MemoryRouter initialEntries={["/personas"]}>
        <Routes>
          <Route path="/personas" element={<PersonasScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("persona-list")).toBeTruthy();
    });
    expect(screen.getByTestId("new-persona")).toBeTruthy();
    // At least one item rendered
    const items = document.querySelectorAll('[data-testid^="persona-item-"]');
    expect(items.length).toBeGreaterThanOrEqual(3);
  });
});

describe("PersonaEditScreen smoke", () => {
  test("new persona form rejects empty name + system prompt", async () => {
    render(
      <MemoryRouter initialEntries={["/personas/new"]}>
        <Routes>
          <Route path="/personas/:id" element={<PersonaEditScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("p-name")).toBeTruthy());

    const save = screen.getByTestId("p-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("p-name"), { target: { value: "New Persona" } });
    fireEvent.change(screen.getByTestId("p-system"), {
      target: { value: "You are New Persona." },
    });

    await waitFor(() => {
      const s = screen.getByTestId("p-save") as HTMLButtonElement;
      expect(s.disabled).toBe(false);
    });
  });
});
