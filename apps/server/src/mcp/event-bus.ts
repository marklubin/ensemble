/**
 * Local stub for the scheduler EventBus surface that Agent B's
 * moderator tool handlers need. Agent A owns the real implementation
 * under apps/server/src/scheduler/event-bus.ts and will replace this
 * during orchestrator integration.
 *
 * The contract Agent B requires (kept minimal — only the moderator
 * tools touch it):
 *
 *   - publish(event): fire-and-forget. The scheduler interprets the
 *     event and adjusts queue / cooldowns accordingly.
 *   - subscribe(handler): hook for forwarding into a real bus once
 *     wired by the orchestrator.
 *
 * Keeping this interface narrow lets the orchestrator drop in A's
 * EventBus with a one-line wire-up in apps/server/src/index.ts (see
 * HANDOFF.md).
 */

export type ModeratorEventKind =
  | "force_speaker"
  | "cooldown"
  | "bypass"
  | "inject";

export interface ModeratorBusEvent {
  kind: ModeratorEventKind;
  session_id: string;
  /** seat that issued the moderator action (the caller) */
  issuer_seat_id: string;
  /** target seat for force_speaker / cooldown / bypass; absent for inject */
  target_seat_id?: string;
  rounds?: number;
  reason?: string;
  timestamp: string;
}

export type BusEvent = { type: "moderator"; payload: ModeratorBusEvent };
export type BusHandler = (event: BusEvent) => void | Promise<void>;

export interface IEventBus {
  publish(event: BusEvent): void;
  subscribe(handler: BusHandler): () => void;
}

/**
 * Default in-process EventBus implementation. Stand-in until Agent A's
 * real bus replaces it.
 */
export class InProcessEventBus implements IEventBus {
  private readonly handlers = new Set<BusHandler>();

  publish(event: BusEvent): void {
    for (const h of this.handlers) {
      // Fire-and-forget; swallow errors so one bad subscriber doesn't
      // poison the moderator tool response.
      try {
        void h(event);
      } catch {
        /* noop */
      }
    }
  }

  subscribe(handler: BusHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
