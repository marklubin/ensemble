/**
 * Client-side of the UiBridge wire protocol (Agent E owns the server side).
 *
 * Responsibilities:
 *   - Subscribe to `GET /ui-bridge/events?session_id=…&seat_id=…` SSE
 *     stream. Inbound messages are `UiBridgeMessage` JSON.
 *   - When the server sends `focus`, raise the consumer's `onFocus`
 *     callback so the session screen can autofocus the textarea.
 *   - Forward the user's keystrokes as `chunk` messages to
 *     `POST /ui-bridge/messages`.
 *   - On submit/cancel, forward the matching terminal message.
 *
 * Streaming choice (documented in HANDOFF): one keystroke == one chunk.
 * This gives the smoothest character-stream experience for other personas
 * watching the human type. Implementations may switch to debounced batches
 * if perf becomes an issue; the wire format is unchanged.
 */
import type { UiBridgeMessage } from "@ensemble/shared";
import { UiBridgeMessage as UiBridgeMessageSchema } from "@ensemble/shared";

export interface UiBridgeClientOptions {
  sessionId: string;
  seatId: string;
  /** Base path; defaults to "" (proxy / same-origin). */
  baseUrl?: string;
  /** Inject for tests. */
  fetchImpl?: typeof fetch;
  EventSourceCtor?: typeof EventSource;
  onFocus?: (msg: Extract<UiBridgeMessage, { kind: "focus" }>) => void;
  onBlur?: (msg: Extract<UiBridgeMessage, { kind: "blur" }>) => void;
  onError?: (err: unknown) => void;
}

export interface UiBridgeClient {
  /** The active turn the server most recently asked us to focus, if any. */
  currentTurnId(): string | null;
  /** Send one chunk (typically one keystroke). */
  sendChunk(text: string): Promise<void>;
  /** Tell the server the user submitted. Returns once the POST settles. */
  submit(): Promise<void>;
  /** Tell the server the user cancelled. */
  cancel(reason?: string): Promise<void>;
  /** Tear down the SSE subscription. */
  close(): void;
}

export function createUiBridgeClient(opts: UiBridgeClientOptions): UiBridgeClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const ESCtor = opts.EventSourceCtor ?? (globalThis.EventSource as typeof EventSource | undefined);
  const base = opts.baseUrl ?? "";

  let activeTurnId: string | null = null;
  let closed = false;
  let source: EventSource | null = null;

  const eventsUrl = `${base}/ui-bridge/events?session_id=${encodeURIComponent(opts.sessionId)}&seat_id=${encodeURIComponent(opts.seatId)}`;
  const postUrl = `${base}/ui-bridge/messages`;

  if (ESCtor) {
    source = new ESCtor(eventsUrl);
    source.onmessage = (e: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(e.data);
      } catch {
        return;
      }
      const parsed = UiBridgeMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.kind === "focus") {
        activeTurnId = msg.turn_id;
        opts.onFocus?.(msg);
      } else if (msg.kind === "blur") {
        activeTurnId = null;
        opts.onBlur?.(msg);
      }
    };
    source.onerror = (err) => {
      if (!closed) opts.onError?.(err);
    };
  }

  const post = async (message: UiBridgeMessage) => {
    try {
      await fetchImpl(postUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
    } catch (err) {
      opts.onError?.(err);
    }
  };

  return {
    currentTurnId: () => activeTurnId,
    async sendChunk(text: string) {
      if (!activeTurnId) return;
      await post({
        kind: "chunk",
        seat_id: opts.seatId,
        turn_id: activeTurnId,
        text,
      });
    },
    async submit() {
      if (!activeTurnId) return;
      const turn = activeTurnId;
      activeTurnId = null;
      await post({ kind: "submit", seat_id: opts.seatId, turn_id: turn });
    },
    async cancel(reason?: string) {
      if (!activeTurnId) return;
      const turn = activeTurnId;
      activeTurnId = null;
      await post({
        kind: "cancel",
        seat_id: opts.seatId,
        turn_id: turn,
        reason,
      });
    },
    close() {
      closed = true;
      source?.close();
    },
  };
}
