import type { SeatInfo, TurnTakingMode } from "@ensemble/shared";

/**
 * Read-only view onto session state that the MCP tool handlers need.
 *
 * The scheduler (Agent A) owns the canonical state. During Phase 1,
 * Agent B uses this thin registry so its handlers can be tested in
 * isolation. At orchestrator integration, the scheduler will register
 * each live session with this registry (see HANDOFF.md).
 *
 * Read-only by design — moderator mutations flow over the EventBus,
 * not by mutating registry state directly.
 */

export interface SessionView {
  session_id: string;
  cast: SeatInfo[];
  /** Current round number (1-based once started, 0 before). */
  round: number;
  mode: TurnTakingMode;
  /** Remaining cooldown rounds for a given seat. */
  cooldownFor(seatId: string): number;
}

export interface ISessionRegistry {
  get(sessionId: string): SessionView | undefined;
}

/** Default in-memory registry. */
export class SessionRegistry implements ISessionRegistry {
  private readonly sessions = new Map<string, SessionView>();

  register(view: SessionView): void {
    this.sessions.set(view.session_id, view);
  }

  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  get(sessionId: string): SessionView | undefined {
    return this.sessions.get(sessionId);
  }
}
