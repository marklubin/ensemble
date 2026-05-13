import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { createTemplateRoutes } from "./routes.ts";

function app() {
  const a = new Hono();
  a.route("/templates", createTemplateRoutes());
  return a;
}

describe("templates routes", () => {
  test("GET / returns v1 presets", async () => {
    const r = await app().request("/templates");
    expect(r.status).toBe(200);
    const list = (await r.json()) as Array<{ id: string; name: string }>;
    expect(list.map((t) => t.id).sort()).toEqual(["debate", "roundtable"]);
  });

  test("GET /:id returns one or 404", async () => {
    const a = app();
    const r1 = await a.request("/templates/debate");
    expect(r1.status).toBe(200);
    const r2 = await a.request("/templates/nope");
    expect(r2.status).toBe(404);
  });
});
