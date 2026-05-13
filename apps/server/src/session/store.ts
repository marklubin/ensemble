import type {
  InstanceHandle,
  PersonaRuntime,
  ScenarioFormat,
  SeatInfo,
  TurnTakingMode,
} from "@ensemble/shared";

import {
  EventBus,
  SessionScheduler,
  type SessionLength,
} from "../scheduler/index.ts";

// `SessionLength` lives in the scheduler module; re-export for callers.
export type { SessionLength } from "../scheduler/index.ts";

/**
 * SessionState — what the session store keeps per-session.
 *
 * The session route owns the lifecycle: it creates a state on
 * POST /sessions, the SSE route subscribes to its EventBus, and
 * POST /sessions/:id/start spins up the scheduler.
 */
export interface SessionState {
  session_id: string;
  template_id: string;
  scenario: string;
  scenario_format: ScenarioFormat;
  cast: SeatInfo[];
  turn_taking_mode: TurnTakingMode;
  length: SessionLength;
  bus: EventBus;
  scheduler: SessionScheduler | null;
  /** Per-seat InstanceHandles (typically populated at start time once runtimes attach). */
  handles: Map<string, InstanceHandle>;
  /** Per-seat runtimes (looked up by runtime_type at start time). */
  runtimes: Map<string, PersonaRuntime>;
  /** Handle IDs that detach() has been called on. */
  detachedHandles: string[];
  /** Count of every SseEvent published on this session's bus. */
  eventCount: number;
  /** Started-at timestamp set when /start succeeds; null before then. */
  started_at: string | null;
  status: "created" | "running" | "ended";
  created_at: string;
}

/**
 * In-memory session registry. Phase-1 placeholder; persistence is a
 * later concern. Lives at module scope so routes share it.
 */
class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  create(state: SessionState): void {
    this.sessions.set(state.session_id, state);
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  list(): SessionState[] {
    return [...this.sessions.values()];
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

export const sessionStore = new SessionStore();
