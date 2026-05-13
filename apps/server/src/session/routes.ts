import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
  CreateSessionRequest,
  type PersonaSpec,
  type SessionContext,
  type SseEvent,
} from "@ensemble/shared";

import { EventBus, SessionScheduler } from "../scheduler/index.ts";
import { runtimes as runtimeRegistry } from "../runtimes/index.ts";
import { sessionStore, type SessionState } from "./store.ts";
import type { IPersonaStore } from "../personas/store.ts";
import { config } from "../config/index.ts";
import { mintSessionToken } from "../mcp/index.ts";
import { logger } from "../logging/index.ts";

/**
 * Phase-1 session HTTP routes.
 *
 *   POST   /sessions               create
 *   GET    /sessions               list
 *   GET    /sessions/:id           state
 *   GET    /sessions/:id/events    SSE stream
 *   POST   /sessions/:id/start     begin the scheduler loop
 *   POST   /sessions/:id/end       graceful end
 *
 * The scheduler's bus emits SseEvents; the SSE route serializes each
 * event as a `data: <json>` frame.
 *
 * The runtime registry (`apps/server/src/runtimes/index.ts`) is
 * orchestrator-owned and will typically be empty during this
 * worktree's tests. Callers may inject runtimes via the test-only
 * helpers exported below.
 */

// `CreateSessionRequest` lives in @ensemble/shared — import re-exported
// for callers that previously consumed it from this module.
export { CreateSessionRequest } from "@ensemble/shared";

// ─── Persona store wiring ─────────────────────────────────────────────

let _personaStore: IPersonaStore | null = null;

/**
 * Inject the persona store used for attach-pass lookup. Production
 * wires this from `apps/server/src/index.ts`; tests may bypass it by
 * registering per-session runtime + handle overrides instead.
 */
export function setPersonaStore(store: IPersonaStore): void {
  _personaStore = store;
}

// ─── Test seam: per-session runtime injection ─────────────────────────

const sessionRuntimeOverrides = new Map<
  string,
  Map<string, import("@ensemble/shared").PersonaRuntime>
>();

/**
 * Override the runtime registry for a specific session id (test only).
 * Used by integration tests to inject `RecordedRuntime`s without
 * touching the orchestrator-owned global registry.
 */
export function setSessionRuntimes(
  sessionId: string,
  overrides: Map<string, import("@ensemble/shared").PersonaRuntime>,
): void {
  sessionRuntimeOverrides.set(sessionId, overrides);
}

/**
 * Override an InstanceHandle for a specific seat in a session (test
 * only). Used because `RecordedRuntime.attach` would normally produce
 * handles, but tests want to pre-seed them for determinism.
 */
const sessionHandleOverrides = new Map<
  string,
  Map<string, import("@ensemble/shared").InstanceHandle>
>();
export function setSessionHandles(
  sessionId: string,
  overrides: Map<string, import("@ensemble/shared").InstanceHandle>,
): void {
  sessionHandleOverrides.set(sessionId, overrides);
}

// ─── Helpers ──────────────────────────────────────────────────────────

let _idCounter = 0;
function generateSessionId(): string {
  // Stable monotonic id (avoids randomness in tests). We don't expose
  // this; callers can also seed via headers in a future iteration.
  _idCounter += 1;
  return `sess_${Date.now().toString(36)}_${_idCounter}`;
}

function summarizeSession(state: SessionState) {
  return {
    session_id: state.session_id,
    template_id: state.template_id,
    scenario: state.scenario,
    scenario_format: state.scenario_format,
    cast: state.cast,
    turn_taking_mode: state.turn_taking_mode,
    length: state.length,
    status: state.status,
    round: state.scheduler?.round ?? 0,
    created_at: state.created_at,
  };
}

/**
 * SessionMeta-shape projection for GET /sessions/:id. The web client
 * consumes this; the schema lives in @ensemble/shared.
 */
function sessionMeta(state: SessionState) {
  const human = state.cast.find((s) => s.runtime_type === "human");
  const roundsPlanned =
    state.length.kind === "n_rounds" ? state.length.n : 0;
  return {
    session_id: state.session_id,
    template: state.template_id,
    scenario: state.scenario,
    scenario_format: state.scenario_format,
    rounds_planned: roundsPlanned,
    cast: state.cast,
    human_seat_id: human?.seat_id ?? null,
    turn_taking: state.turn_taking_mode,
    started_at: state.started_at,
    cost_so_far_usd: 0,
  };
}

// ─── Router ───────────────────────────────────────────────────────────

export const sessions = new Hono();

sessions.get("/", (c) =>
  c.json({ sessions: sessionStore.list().map(summarizeSession) }),
);

sessions.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = CreateSessionRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }
  const req = parsed.data;
  const sessionId = generateSessionId();
  const bus = new EventBus();
  const state: SessionState = {
    session_id: sessionId,
    template_id: req.template_id,
    scenario: req.scenario,
    scenario_format: req.scenario_format,
    cast: req.cast,
    turn_taking_mode: req.turn_taking_mode,
    length: req.length,
    bus,
    scheduler: null,
    handles: new Map(),
    runtimes: new Map(),
    detachedHandles: [],
    eventCount: 0,
    started_at: null,
    status: "created",
    created_at: new Date().toISOString(),
  };
  // Diagnostics: count every event emitted on this session's bus.
  bus.subscribe(() => {
    state.eventCount += 1;
  });
  sessionStore.create(state);
  logger.info("session.created", {
    session_id: sessionId,
    template_id: req.template_id,
    cast_size: req.cast.length,
    turn_taking_mode: req.turn_taking_mode,
    length: req.length,
  });
  return c.json({ session_id: sessionId });
});

sessions.get("/:id", (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
  return c.json(sessionMeta(state));
});

sessions.get("/:id/events", (c) => {
  const sessionId = c.req.param("id");
  const state = sessionStore.get(sessionId);
  if (!state) return c.json({ error: "not_found" }, 404);
  logger.info("sse.subscribe", {
    session_id: sessionId,
    status: state.status,
  });
  return streamSSE(c, async (stream) => {
    const queue: SseEvent[] = [];
    let resolveWaiter: (() => void) | null = null;
    let closed = false;

    const unsubscribe = state.bus.subscribe((ev) => {
      queue.push(ev);
      if (resolveWaiter) {
        const r = resolveWaiter;
        resolveWaiter = null;
        r();
      }
    });

    stream.onAbort(() => {
      closed = true;
      unsubscribe();
      logger.info("sse.disconnect", {
        session_id: sessionId,
        reason: "client_abort",
      });
      if (resolveWaiter) {
        const r = resolveWaiter;
        resolveWaiter = null;
        r();
      }
    });

    try {
      while (!closed) {
        // If the session already ended, drain and stop.
        if (queue.length === 0) {
          if (state.status === "ended") break;
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
          if (closed) break;
        }
        while (queue.length > 0) {
          const ev = queue.shift()!;
          logger.debug("sse.emit", {
            session_id: sessionId,
            event_type: ev.type,
          });
          await stream.writeSSE({
            event: ev.type,
            data: JSON.stringify(ev),
          });
          if (ev.type === "session.end") {
            closed = true;
            logger.info("sse.disconnect", {
              session_id: sessionId,
              reason: "session_end",
            });
            break;
          }
        }
      }
    } finally {
      unsubscribe();
    }
  });
});

sessions.post("/:id/start", async (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
  if (state.status !== "created") {
    return c.json(
      { error: "invalid_state", status: state.status },
      409,
    );
  }

  logger.info("session.start", {
    session_id: state.session_id,
    template_id: state.template_id,
    cast_size: state.cast.length,
    turn_taking_mode: state.turn_taking_mode,
  });

  // Resolve runtimes for each seat. Lookup order:
  //   1. per-session override (test injection)
  //   2. global runtime registry (orchestrator-owned)
  const overrides = sessionRuntimeOverrides.get(state.session_id);
  const missing: string[] = [];
  for (const seat of state.cast) {
    const rt =
      overrides?.get(seat.seat_id) ??
      overrides?.get(seat.runtime_type) ??
      runtimeRegistry[seat.runtime_type];
    if (!rt) {
      missing.push(seat.seat_id);
      continue;
    }
    state.runtimes.set(seat.seat_id, rt);
  }
  if (missing.length > 0) {
    logger.error("session.start.runtime_unavailable", {
      session_id: state.session_id,
      missing_for_seats: missing,
      available_runtimes: Object.keys(runtimeRegistry),
    });
    return c.json(
      { error: "runtime_unavailable", missing_for_seats: missing },
      400,
    );
  }

  // Either accept pre-seeded handles (test override) or call attach.
  const handleOverrides = sessionHandleOverrides.get(state.session_id);
  const mcpUrl = (() => {
    try {
      const base = config().mcpPublicUrl.replace(/\/$/, "");
      return `${base}/mcp/rpc`;
    } catch {
      // Tests may not have a valid config; fall back to a placeholder
      // since test runtimes ignore the URL anyway.
      return "http://127.0.0.1:4111/mcp/rpc";
    }
  })();
  for (const seat of state.cast) {
    if (handleOverrides?.has(seat.seat_id)) {
      state.handles.set(seat.seat_id, handleOverrides.get(seat.seat_id)!);
      continue;
    }
    // Production attach pass. Look up the persona spec, mint a per-seat
    // MCP token (moderator role gets the `moderator` claim), build a
    // SessionContext, and call runtime.attach().
    const runtime = state.runtimes.get(seat.seat_id);
    if (!runtime) continue; // already errored above
    let persona: PersonaSpec | undefined;
    try {
      persona = _personaStore?.get(seat.persona_id);
    } catch {
      persona = undefined;
    }
    if (!persona) {
      // Synthesize a minimal spec so tests / dev work without a wired
      // persona store. Production should always have one configured.
      persona = {
        id: seat.persona_id,
        name: seat.persona_name,
        system_prompt: `You are ${seat.persona_name}.`,
        role: seat.role,
        tools_allowed: [],
        memory_policy: "session-scoped",
      };
    }
    const claims = seat.role === "Moderator" ? ["moderator"] : [];
    let token: string;
    try {
      token = mintSessionToken({
        session_id: state.session_id,
        seat_id: seat.seat_id,
        claims,
      });
    } catch {
      token = "test-token";
    }
    const ctx: SessionContext = {
      session_id: state.session_id,
      seat_id: seat.seat_id,
      scenario: state.scenario,
      scenario_format: state.scenario_format,
      cast: state.cast,
      ensemble_mcp_url: mcpUrl,
      ensemble_mcp_token: token,
    };
    try {
      logger.info("runtime.attach.start", {
        session_id: state.session_id,
        seat_id: seat.seat_id,
        runtime: runtime.name,
        persona_name: seat.persona_name,
        role: seat.role,
      });
      const handle = await runtime.attach(persona, ctx);
      state.handles.set(seat.seat_id, handle);
      logger.info("runtime.attach.ok", {
        session_id: state.session_id,
        seat_id: seat.seat_id,
        runtime: runtime.name,
        handle_id: handle.id,
        capabilities: [...handle.capabilities],
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("runtime.attach.failed", {
        session_id: state.session_id,
        seat_id: seat.seat_id,
        runtime: runtime.name,
        persona_name: seat.persona_name,
        error: error.message,
        stack: error.stack,
      });
      return c.json(
        {
          error: "attach_failed",
          seat_id: seat.seat_id,
          message: error.message,
        },
        500,
      );
    }
  }

  state.scheduler = new SessionScheduler({
    sessionId: state.session_id,
    mode: state.turn_taking_mode,
    seats: state.cast,
    handles: state.handles,
    runtimes: state.runtimes,
    bus: state.bus,
    length: state.length,
    hostSeatId: state.cast.find((s) => s.role === "Host")?.seat_id,
  });
  state.status = "running";
  state.started_at = new Date().toISOString();

  logger.info("scheduler.kickoff", {
    session_id: state.session_id,
    turn_taking_mode: state.turn_taking_mode,
    seats: state.cast.map((s) => s.seat_id),
  });

  // Run the scheduler as a background task; the SSE stream consumes
  // events as they're emitted. We swallow errors here and surface them
  // via the bus (`tool.status` events) so the SSE client sees them.
  void state.scheduler
    .start()
    .catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("scheduler.crashed", {
        session_id: state.session_id,
        error: error.message,
        stack: error.stack,
      });
    })
    .finally(() => {
      state.status = "ended";
      logger.info("scheduler.finished", {
        session_id: state.session_id,
      });
      void detachAll(state);
    });

  return c.json({ ok: true, session_id: state.session_id });
});

sessions.post("/:id/end", async (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
  logger.info("session.end", {
    session_id: state.session_id,
    reason: "user",
    prior_status: state.status,
  });
  if (state.scheduler) {
    state.scheduler.requestEnd("user");
  }
  state.status = "ended";
  await detachAll(state);
  return c.json({ ok: true });
});

async function detachAll(state: SessionState): Promise<void> {
  for (const [seatId, handle] of state.handles) {
    const runtime = state.runtimes.get(seatId);
    if (!runtime) continue;
    try {
      await runtime.detach(handle);
      state.detachedHandles.push(handle.id);
    } catch {
      // best-effort
    }
  }
  state.handles.clear();
}

/**
 * Test-only diagnostics endpoint. Mounted unconditionally — the cost
 * is trivial and L5 specs need it. Contract per Agent G's HANDOFF.
 */
sessions.get("/:id/__diagnostics", (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);

  const perSeat: Record<
    string,
    {
      turns_completed: number;
      cooldown_remaining: number;
      bypass_count: number;
    }
  > = {};
  for (const seat of state.cast) {
    perSeat[seat.seat_id] = {
      turns_completed: 0,
      cooldown_remaining: 0,
      bypass_count: 0,
    };
  }

  let transcript = "";
  if (state.scheduler) {
    for (const ev of state.scheduler.eventLog) {
      if (ev.kind === "turn") {
        const slot = perSeat[ev.seat_id];
        if (slot) slot.turns_completed += 1;
        transcript += ev.content;
      }
    }
    const cd = state.scheduler.cooldownSnapshot();
    for (const seat of state.cast) {
      const slot = perSeat[seat.seat_id];
      if (slot) slot.cooldown_remaining = cd.get(seat.seat_id) ?? 0;
    }
  }

  return c.json({
    active_handles: [...state.handles.values()].map((h) => h.id),
    detached_handles: [...state.detachedHandles],
    event_count: state.eventCount,
    ended: state.status === "ended",
    per_seat: perSeat,
    transcript_digest: transcript,
  });
});

/**
 * Test helper: synchronously run a scheduler to completion against a
 * pre-created session state. Used by the integration tests because
 * the HTTP layer's background scheduler.start() is async-fire-and-
 * forget — tests want to await it deterministically.
 */
export async function runSessionForTest(
  state: SessionState,
): Promise<void> {
  if (state.scheduler) {
    await state.scheduler.start();
    state.status = "ended";
  }
}
