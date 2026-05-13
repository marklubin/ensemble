import { Hono } from "hono";
import {
  ModBypassInput,
  ModCooldownInput,
  ModForceSpeakerInput,
} from "@ensemble/shared";
import { z } from "zod";

import { sessionStore } from "./store.ts";

/**
 * Moderator proxy. Path the web UI's moderator card uses to drive the
 * scheduler. Distinct from the MCP `moderator.*` tool path, which is
 * for agents (and requires the `moderator` claim).
 *
 *   POST /sessions/:id/moderator/force_speaker  body { seat_id }
 *   POST /sessions/:id/moderator/cooldown       body { seat_id, rounds, reason }
 *   POST /sessions/:id/moderator/bypass         body { seat_id, reason }
 *   POST /sessions/:id/moderator/inject         body { content }
 *
 * Auth: same as memory routes — session-exists is the v1 trust
 * boundary. Documented in TEST_PROTOCOL.md.
 */

const ModInjectBodyV1 = z.object({ content: z.string().min(1) });

export function createModeratorRoutes(): Hono {
  const r = new Hono();

  r.post("/:id/moderator/:tool", async (c) => {
    const id = c.req.param("id");
    const tool = c.req.param("tool");
    const state = sessionStore.get(id);
    if (!state) return c.json({ error: "not_found" }, 404);
    if (!state.scheduler) {
      return c.json({ error: "not_started" }, 409);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    switch (tool) {
      case "force_speaker": {
        const p = ModForceSpeakerInput.safeParse(body);
        if (!p.success) {
          return c.json(
            { error: "invalid_request", details: p.error.flatten() },
            400,
          );
        }
        state.scheduler.forceSpeaker(p.data.seat_id);
        return c.json({ ok: true });
      }
      case "cooldown": {
        const p = ModCooldownInput.safeParse(body);
        if (!p.success) {
          return c.json(
            { error: "invalid_request", details: p.error.flatten() },
            400,
          );
        }
        state.scheduler.applyCooldown(
          p.data.seat_id,
          p.data.rounds,
          p.data.reason,
        );
        return c.json({ ok: true });
      }
      case "bypass": {
        const p = ModBypassInput.safeParse(body);
        if (!p.success) {
          return c.json(
            { error: "invalid_request", details: p.error.flatten() },
            400,
          );
        }
        // bypass-this-round is modeled as a 1-round cooldown for v1.
        state.scheduler.applyCooldown(p.data.seat_id, 1, p.data.reason);
        return c.json({ ok: true });
      }
      case "inject": {
        const p = ModInjectBodyV1.safeParse(body);
        if (!p.success) {
          return c.json(
            { error: "invalid_request", details: p.error.flatten() },
            400,
          );
        }
        state.scheduler.injectModeratorMessage(p.data.content);
        return c.json({ ok: true });
      }
      default:
        return c.json({ error: "unknown_tool", tool }, 400);
    }
  });

  return r;
}
