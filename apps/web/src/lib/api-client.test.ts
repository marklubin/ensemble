import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, __mocks } from "./api-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api-client mock fallback", () => {
  test("templates.list falls back to mock when fetch rejects", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const ts = await api.templates.list();
    expect(ts.map((t) => t.id).sort()).toEqual(["debate", "roundtable"]);
  });

  test("templates.list falls back to mock on 404", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("nope", { status: 404 }))) as unknown as typeof fetch;
    const ts = await api.templates.list();
    expect(ts.length).toBeGreaterThan(0);
  });

  test("templates.list uses server response when 200 OK", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify([{ id: "x", name: "Live" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as unknown as typeof fetch;
    const ts = await api.templates.list();
    expect(ts).toEqual([{ id: "x", name: "Live" }] as unknown as typeof ts);
  });

  test("personas.save round-trips through the mock store when offline", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
    const before = await api.personas.list();
    const beforeCount = before.length;
    await api.personas.save({
      id: "test-temp-persona",
      name: "Test Temp",
      system_prompt: "x",
      tools_allowed: [],
      memory_policy: "ephemeral",
    });
    const after = await api.personas.list();
    expect(after.length).toBe(beforeCount + 1);
    await api.personas.delete("test-temp-persona");
    const final = await api.personas.list();
    expect(final.length).toBe(beforeCount);
  });

  test("sessions.create returns a synthetic id when server is missing", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("nope", { status: 501 }))) as unknown as typeof fetch;
    const r = await api.sessions.create({
      template_id: "debate",
      scenario: "Resolved: X",
      scenario_format: "motion",
      cast: [
        {
          seat_id: "s1",
          persona_id: "alex-chen",
          persona_name: "Alex Chen",
          role: "Pro",
          runtime_type: "managed-agents",
        },
        {
          seat_id: "s2",
          persona_id: "jordan-rivera",
          persona_name: "Jordan Rivera",
          role: "Con",
          runtime_type: "managed-agents",
        },
      ],
      turn_taking_mode: "shuffled",
      length: { kind: "open-ended" },
      cooldown_rounds: 1,
      target_words_per_turn: 120,
    });
    expect(r.session_id.startsWith("mock-")).toBe(true);
  });

  test("mock fixture data is shaped consistently", () => {
    expect(__mocks.MOCK_TEMPLATES.length).toBe(2);
    expect(__mocks.MOCK_PERSONAS.length).toBeGreaterThanOrEqual(3);
  });
});
