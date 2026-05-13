import { Hono } from "hono";
import { z } from "zod";
import { PersonaSpec } from "@ensemble/shared";
import type { IPersonaStore } from "./store.ts";

/**
 * Persona library CRUD routes.
 *
 *   GET    /personas         — list
 *   GET    /personas/:id     — one
 *   POST   /personas         — create (body is PersonaSpec; id may be
 *                              client-assigned or omitted for synthesis)
 *   PUT    /personas/:id     — upsert
 *   DELETE /personas/:id     — delete
 *
 * No auth in v1 — same trust boundary as the rest of the workspace.
 * The store is process-wide; production wires a SqlitePersonaStore.
 */

const PersonaSpecMaybeId = PersonaSpec.partial({ id: true });

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64) || `persona-${Date.now().toString(36)}`;
}

export function createPersonaRoutes(store: IPersonaStore): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json(store.list()));

  r.get("/:id", (c) => {
    const p = store.get(c.req.param("id"));
    if (!p) return c.json({ error: "not_found" }, 404);
    return c.json(p);
  });

  r.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = PersonaSpecMaybeId.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }
    const id = parsed.data.id ?? slugify(parsed.data.name);
    const spec: z.infer<typeof PersonaSpec> = { ...parsed.data, id };
    if (store.get(id)) {
      return c.json({ error: "already_exists", id }, 409);
    }
    store.put(spec);
    return c.json(spec, 201);
  });

  r.put("/:id", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = PersonaSpecMaybeId.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }
    const spec: z.infer<typeof PersonaSpec> = { ...parsed.data, id };
    store.put(spec);
    return c.json(spec);
  });

  r.delete("/:id", (c) => {
    const id = c.req.param("id");
    const removed = store.delete(id);
    if (!removed) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return r;
}
