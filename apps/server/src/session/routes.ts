import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  ScenarioFormat,
  SeatInfo,
  TurnTakingMode,
  type SseEvent,
} from "@ensemble/shared";

import { EventBus, SessionScheduler } from "../scheduler/index.ts";
import { runtimes as runtimeRegistry } from "../runtimes/index.ts";
import { sessionStore, type SessionLength, type SessionState } from "./store.ts";

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

// ─── Zod request schemas ──────────────────────────────────────────────

const SessionLengthSchema: z.ZodType<SessionLength> = z.union([
  z.object({ kind: z.literal("open-ended") }),
  z.object({ kind: z.literal("n_rounds"), n: z.number().int().min(1) }),
]);

export const CreateSessionRequest = z.object({
  template_id: z.string().min(1),
  scenario: z.string().min(1),
  scenario_format: ScenarioFormat.default("open"),
  cast: z.array(SeatInfo).min(1),
  turn_taking_mode: TurnTakingMode,
  length: SessionLengthSchema.default({ kind: "open-ended" }),
  cooldown_rounds: z.number().int().min(0).default(1),
  host_seat_id: z.string().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

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
    status: "created",
    created_at: new Date().toISOString(),
  };
  sessionStore.create(state);
  return c.json({ session_id: sessionId });
});

sessions.get("/:id", (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
  return c.json(summarizeSession(state));
});

sessions.get("/:id/events", (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
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
          await stream.writeSSE({
            event: ev.type,
            data: JSON.stringify(ev),
          });
          if (ev.type === "session.end") {
            closed = true;
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
    return c.json(
      { error: "runtime_unavailable", missing_for_seats: missing },
      400,
    );
  }

  // Either accept pre-seeded handles (test override) or call attach.
  const handleOverrides = sessionHandleOverrides.get(state.session_id);
  for (const seat of state.cast) {
    if (handleOverrides?.has(seat.seat_id)) {
      state.handles.set(seat.seat_id, handleOverrides.get(seat.seat_id)!);
    }
    // If no override: the orchestrator's higher-level lifecycle is
    // expected to call attach() before /start in the integrated build.
    // Phase-1 worktree tests always pre-seed handles via override.
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

  // Run the scheduler as a background task; the SSE stream consumes
  // events as they're emitted. We swallow errors here and surface them
  // via the bus (`tool.status` events) so the SSE client sees them.
  void state.scheduler
    .start()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[scheduler]", err);
    })
    .finally(() => {
      state.status = "ended";
    });

  return c.json({ ok: true, session_id: state.session_id });
});

sessions.post("/:id/end", (c) => {
  const state = sessionStore.get(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
  if (state.scheduler) {
    state.scheduler.requestEnd("user");
  }
  state.status = "ended";
  return c.json({ ok: true });
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
