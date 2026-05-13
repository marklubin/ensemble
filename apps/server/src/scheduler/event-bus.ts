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
  private closed = false;

  /**
   * Subscribe to events. Returns an unsubscribe function.
   */
  subscribe(fn: EventSubscriber): () => void {
    if (this.closed) {
      throw new Error("EventBus is closed");
    }
    this.subscribers.add(fn);
    return () => this.unsubscribe(fn);
  }

  /** Remove a subscriber. Idempotent. */
  unsubscribe(fn: EventSubscriber): void {
    this.subscribers.delete(fn);
  }

  /** Publish an event to every current subscriber. */
  publish(event: SseEvent): void {
    if (this.closed) return;
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
