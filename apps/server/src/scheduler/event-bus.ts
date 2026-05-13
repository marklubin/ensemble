import type { SseEvent } from "@ensemble/shared";

/**
 * Per-session event bus. Multiple subscribers can receive the same
 * `SseEvent`. Synchronous publish semantics: a publish call returns
 * after every subscriber's handler has been invoked, but each handler
 * is invoked inside a try/catch so a single bad subscriber cannot
 * break others.
 *
 * Used by:
 *  - The scheduler to emit lifecycle / turn / cooldown events.
 *  - The session SSE route to forward events to HTTP clients.
 *  - The Host API MCP server (Agent B) to inject moderator messages.
 *
 * The bus is intentionally minimal — no backpressure or buffering of
 * historical events. Callers that need replay must record events
 * themselves.
 */
export type EventSubscriber = (event: SseEvent) => void;

export class EventBus {
  private readonly subscribers = new Set<EventSubscriber>();
  private readonly history: SseEvent[] = [];
  private closed = false;

  /**
   * Subscribe to events. Returns an unsubscribe function.
   *
   * Late subscribers (e.g. a browser EventSource that connects after
   * the scheduler has already emitted some events) opt into a replay
   * of historical events via `replayHistory: true`. This keeps short
   * sessions visible in the UI even when the scheduler finishes
   * before the client's network round-trip completes.
   */
  subscribe(
    fn: EventSubscriber,
    opts: { replayHistory?: boolean } = {},
  ): () => void {
    if (this.closed) {
      throw new Error("EventBus is closed");
    }
    if (opts.replayHistory) {
      // Snapshot so concurrent publishes during replay don't
      // double-deliver. The subscriber registration happens AFTER the
      // replay so live events arriving during the replay aren't
      // missed but also aren't duplicated.
      const snapshot = [...this.history];
      for (const ev of snapshot) {
        try {
          fn(ev);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[EventBus] replay subscriber threw:", err);
        }
      }
    }
    this.subscribers.add(fn);
    return () => this.unsubscribe(fn);
  }

  /** Remove a subscriber. Idempotent. */
  unsubscribe(fn: EventSubscriber): void {
    this.subscribers.delete(fn);
  }

  /** Publish an event to every current subscriber. Records to history for replay. */
  publish(event: SseEvent): void {
    if (this.closed) return;
    this.history.push(event);
    // Snapshot so unsubscribes during iteration don't break the loop.
    const snapshot = [...this.subscribers];
    for (const fn of snapshot) {
      try {
        fn(event);
      } catch (err) {
        // Subscribers must not break the bus. Log and continue.
        // eslint-disable-next-line no-console
        console.error("[EventBus] subscriber threw:", err);
      }
    }
  }

  /** Number of active subscribers (useful for tests / debugging). */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Close the bus: drop subscribers and refuse new ones. */
  close(): void {
    this.closed = true;
    this.subscribers.clear();
  }
}
