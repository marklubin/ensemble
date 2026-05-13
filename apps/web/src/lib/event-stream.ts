/**
 * Typed SSE event-stream client.
 *
 * Wraps `EventSource`, validates each event with `SseEvent`, drops
 * invalid events with a console warning, and offers a typed callback
 * keyed by event variant. Handles reconnect with backoff.
 *
 * Used by:
 *   - `screens/session/index.tsx` (main session view)
 *   - the L1 test harness (which injects a fake `EventSource`)
 */
import { SseEvent } from "@ensemble/shared";

export type SseHandlers = {
  [K in SseEvent["type"]]?: (event: Extract<SseEvent, { type: K }>) => void;
} & {
  /** Catch-all, fires for every valid event. */
  any?: (event: SseEvent) => void;
  /** Connection-level events. */
  open?: () => void;
  error?: (err: unknown) => void;
  invalid?: (raw: unknown, reason: string) => void;
};

export interface EventStreamOptions {
  /** Absolute or proxy-relative URL to the SSE endpoint. */
  url: string;
  handlers: SseHandlers;
  /** Inject a custom EventSource for tests. */
  EventSourceCtor?: typeof EventSource;
  /** Initial backoff in ms. Doubles up to `maxBackoffMs`. */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** When true, the client will not auto-reconnect on close. */
  oneShot?: boolean;
}

export interface EventStreamHandle {
  close: () => void;
  /** Current `readyState` of the underlying EventSource, or `null`. */
  readyState: () => number | null;
}

/**
 * Open a typed SSE stream. The returned handle's `close()` aborts any
 * in-flight reconnect and tears down the underlying EventSource.
 */
export function openEventStream(opts: EventStreamOptions): EventStreamHandle {
  const Ctor = opts.EventSourceCtor ?? (globalThis.EventSource as typeof EventSource | undefined);
  if (!Ctor) {
    throw new Error("EventSource not available in this environment");
  }

  let source: EventSource | null = null;
  let closed = false;
  let backoff = opts.initialBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 15_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    const es = new Ctor(opts.url);
    source = es;

    es.onopen = () => {
      backoff = opts.initialBackoffMs ?? 500;
      opts.handlers.open?.();
    };

    es.onmessage = (msg: MessageEvent) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(msg.data);
      } catch (err) {
        opts.handlers.invalid?.(msg.data, `invalid JSON: ${(err as Error).message}`);
        console.warn("[event-stream] dropping non-JSON SSE event:", msg.data);
        return;
      }

      const parsed = SseEvent.safeParse(parsedJson);
      if (!parsed.success) {
        opts.handlers.invalid?.(parsedJson, parsed.error.message);
        console.warn("[event-stream] dropping invalid SSE event:", parsed.error.message, parsedJson);
        return;
      }

      const event = parsed.data;
      opts.handlers.any?.(event);
      const handler = opts.handlers[event.type] as ((e: SseEvent) => void) | undefined;
      handler?.(event);
    };

    es.onerror = (err) => {
      // Surface SSE failures in the browser console with the URL +
      // current readyState so we can correlate against server-side
      // logs when the session screen appears to hang.
      // eslint-disable-next-line no-console
      console.error("[event-stream] SSE error", {
        url: opts.url,
        readyState: es.readyState,
        err,
      });
      opts.handlers.error?.(err);
      // EventSource auto-reconnects on transient errors when readyState
      // goes back to CONNECTING. If the server actually closed the
      // stream (readyState === CLOSED) we explicitly back off.
      if (es.readyState === 2 /* CLOSED */) {
        try { es.close(); } catch { /* noop */ }
        source = null;
        if (opts.oneShot || closed) return;
        scheduleReconnect();
      }
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, maxBackoff);
    reconnectTimer = setTimeout(connect, delay);
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (source) {
        try { source.close(); } catch { /* noop */ }
      }
    },
    readyState() {
      return source?.readyState ?? null;
    },
  };
}
