import { Hono } from "hono";
import type { IMemoryStore } from "./store.ts";
import { sessionStore } from "../session/store.ts";

/**
 * UI-facing memory routes. The MCP `memory.read|write|list` tools are
 * the agent-facing path; these are the human-operator path.
 *
 * Auth: v1 takes the session-exists check as a sufficient trust
 * boundary — the workspace itself is single-tenant. Multi-tenant
 * deployments would gate this behind a session-owner token. Documented
 * in TEST_PROTOCOL.md.
 *
 *   GET    /sessions/:id/memory/:seat_id        — { keys, values }
 *   GET    /sessions/:id/memory/:seat_id/:key   — { key, value, exists }
 *   PUT    /sessions/:id/memory/:seat_id/:key   — { value } in body
 *   DELETE /sessions/:id/memory/:seat_id/:key   — { ok }
 */
export function createMemoryRoutes(memory: IMemoryStore): Hono {
  const r = new Hono();

  function requireSession(id: string): boolean {
    return sessionStore.has(id);
  }

  r.get("/:id/memory/:seat_id", (c) => {
    const id = c.req.param("id");
    if (!requireSession(id)) return c.json({ error: "not_found" }, 404);
    const seat_id = c.req.param("seat_id");
    const values = memory.dump(id, seat_id);
    return c.json({
      session_id: id,
      seat_id,
      keys: Object.keys(values),
      values,
    });
  });

  r.get("/:id/memory/:seat_id/:key", (c) => {
    const id = c.req.param("id");
    if (!requireSession(id)) return c.json({ error: "not_found" }, 404);
    const seat_id = c.req.param("seat_id");
    const key = c.req.param("key");
    const value = memory.read(id, seat_id, key);
    return c.json({
      key,
      value: value ?? null,
      exists: value !== undefined,
    });
  });

  r.put("/:id/memory/:seat_id/:key", async (c) => {
    const id = c.req.param("id");
    if (!requireSession(id)) return c.json({ error: "not_found" }, 404);
    const seat_id = c.req.param("seat_id");
    const key = c.req.param("key");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    // Accept either { value: ... } envelope or the raw value at the top
    // level. The UI sends the envelope form.
    const value =
      typeof body === "object" && body !== null && "value" in body
        ? (body as { value: unknown }).value
        : body;
    memory.write(id, seat_id, key, value);
    return c.json({ ok: true, key, value });
  });

  r.delete("/:id/memory/:seat_id/:key", (c) => {
    const id = c.req.param("id");
    if (!requireSession(id)) return c.json({ error: "not_found" }, 404);
    const seat_id = c.req.param("seat_id");
    const key = c.req.param("key");
    const removed = memory.delete(id, seat_id, key);
    return c.json({ ok: true, removed });
  });

  return r;
}
