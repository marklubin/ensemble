import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionMemoryPanel } from "./SessionMemoryPanel.tsx";

afterEach(cleanup);

function makeFetcher(initial: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const impl = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (method === "GET") {
      const entries = Array.from(store, ([key, value]) => ({ key, value }));
      return new Response(JSON.stringify(entries), { status: 200 });
    }
    const keyMatch = url.match(/memory\/[^/]+\/([^/?]+)$/);
    const key = keyMatch ? decodeURIComponent(keyMatch[1]!) : "";
    if (method === "PUT" && body && typeof body === "object" && "value" in body) {
      store.set(key, (body as { value: unknown }).value);
      return new Response("{}", { status: 200 });
    }
    if (method === "DELETE") {
      store.delete(key);
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls, store };
}

describe("<SessionMemoryPanel>", () => {
  test("loads, renders, edits, and deletes", async () => {
    const { impl, store } = makeFetcher({
      tone: "skeptical",
      facts_cited: ["pitchbook-q1", "menlo-survey"],
    });

    render(
      <SessionMemoryPanel
        sessionId="s1"
        seatId="seat-jordan"
        seatLabel="Jordan"
        fetchImpl={impl}
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByText("tone"));
    expect(screen.getByText("Memory · Jordan")).toBeTruthy();

    // Edit `tone`
    fireEvent.click(screen.getAllByText("Edit")[0]!);
    const textarea = screen.getByLabelText("Edit value for tone") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '"defensive"' } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(store.get("tone")).toBe("defensive"));

    // Delete `facts_cited`
    const deleteButtons = screen.getAllByText("Delete");
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!);
    await waitFor(() => expect(store.has("facts_cited")).toBe(false));
  });

  test("shows empty state when no entries", async () => {
    const { impl } = makeFetcher({});
    render(
      <SessionMemoryPanel
        sessionId="s1"
        seatId="seat-x"
        seatLabel="X"
        fetchImpl={impl}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("No memory entries."));
  });
});
