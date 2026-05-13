import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { InMemoryPersonaStore } from "./store.ts";
import { createPersonaRoutes } from "./routes.ts";

function app() {
  const store = new InMemoryPersonaStore();
  const a = new Hono();
  a.route("/personas", createPersonaRoutes(store));
  return { a, store };
}

const body = (o: object): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(o),
});

describe("persona routes", () => {
  test("POST creates, GET lists, GET :id reads", async () => {
    const { a } = app();
    const r1 = await a.request(
      "/personas",
      body({
        id: "alice",
        name: "Alice",
        system_prompt: "be Alice",
      }),
    );
    expect(r1.status).toBe(201);

    const r2 = await a.request("/personas");
    expect(r2.status).toBe(200);
    const list = (await r2.json()) as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toContain("alice");

    const r3 = await a.request("/personas/alice");
    expect(r3.status).toBe(200);
  });

  test("POST without id synthesizes one from name", async () => {
    const { a } = app();
    const r = await a.request(
      "/personas",
      body({ name: "Bob the Builder", system_prompt: "build" }),
    );
    expect(r.status).toBe(201);
    const j = (await r.json()) as { id: string };
    expect(j.id).toBe("bob-the-builder");
  });

  test("POST conflict on duplicate id", async () => {
    const { a } = app();
    const init = body({ id: "x", name: "X", system_prompt: "x" });
    const r1 = await a.request("/personas", init);
    expect(r1.status).toBe(201);
    const r2 = await a.request(
      "/personas",
      body({ id: "x", name: "X", system_prompt: "x" }),
    );
    expect(r2.status).toBe(409);
  });

  test("PUT upserts; DELETE removes", async () => {
    const { a } = app();
    const r1 = await a.request("/personas/y", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Y", system_prompt: "y" }),
    });
    expect(r1.status).toBe(200);

    const r2 = await a.request("/personas/y", { method: "DELETE" });
    expect(r2.status).toBe(200);

    const r3 = await a.request("/personas/y");
    expect(r3.status).toBe(404);
  });

  test("invalid body → 400", async () => {
    const { a } = app();
    const r = await a.request("/personas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(r.status).toBe(400);
  });
});
