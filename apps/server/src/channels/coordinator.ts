/**
 * ChannelCoordinator — owns the lifetime of bridge channels (one per
 * (session_id, seat_id) pair) and brokers turn-prompt requests between
 * `ChannelRuntime` and an externally-managed Claude Code session that
 * has the bridge attached.
 *
 * Why this exists.
 *   The "channels" approach launches Claude Code outside of Ensemble.
 *   The channel-bridge MCP server (apps/channel-bridge) runs inside
 *   that Claude Code session and dials *back* to Ensemble over a
 *   WebSocket. The coordinator owns the server end of the WS and
 *   exposes a clean async API to the runtime.
 *
 * Transport boundary.
 *   The coordinator does NOT couple to `ws` or to Bun's native
 *   `ServerWebSocket`. It speaks to the connection through a
 *   `ChannelConnection` interface (send / close / message events).
 *   The WS upgrade glue (apps/server/src/channels/ws-route.ts) wraps
 *   whichever real socket implementation is in play and feeds the
 *   coordinator. Tests can plug an in-process fake.
 *
 * Wire protocol (JSON, line-delimited messages over WS).
 *   bridge -> server: { type: "register", session_id, seat_id, token? }
 *   bridge -> server: { type: "reply", turn_id, content, done }
 *   server -> bridge: { type: "registered" }
 *   server -> bridge: { type: "turn-prompt", turn_id, prompt, meta? }
 *   server -> bridge: { type: "error", message }
 *
 * Auth.
 *   The connection upgrade carries a bearer token in
 *     - the `Sec-WebSocket-Protocol` header as `bearer.<token>`, OR
 *     - the `?token=...` query string.
 *   The coordinator validates with a pluggable `validateToken` fn.
 *   In v1 we use a static token from `ENSEMBLE_CHANNEL_TOKEN`.
 *
 * Single-channel semantics.
 *   At most one connection per (session_id, seat_id). A second
 *   registration for the same key supersedes the first: the old
 *   connection is closed with `code=1000, reason="superseded"` and
 *   any pending dispatches against it are rejected with
 *   `ChannelSupersededError`. This was chosen over "reject duplicate"
 *   because human users reconnect Claude Code frequently during
 *   development; rejecting would surface as a sticky error.
 */

import { z } from "zod";
import { logger } from "../logging/index.ts";

// ─── Public API ──────────────────────────────────────────────────────

/** A reply chunk pushed back from the bridge. */
export interface ReplyChunk {
  content: string;
  done: boolean;
}

export class ChannelNotConnectedError extends Error {
  constructor(sessionId: string, seatId: string) {
    super(
      `No channel connected for (session=${sessionId}, seat=${seatId}). ` +
        `Launch Claude Code with the Ensemble channel bridge attached, ` +
        `or wait for the registration handshake to complete.`,
    );
    this.name = "ChannelNotConnectedError";
  }
}

export class ChannelDisconnectedError extends Error {
  constructor(message = "channel disconnected before reply completed") {
    super(message);
    this.name = "ChannelDisconnectedError";
  }
}

export class ChannelSupersededError extends Error {
  constructor() {
    super("channel was superseded by a newer registration for the same seat");
    this.name = "ChannelSupersededError";
  }
}

export class ChannelTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelTimeoutError";
  }
}

/**
 * Minimal connection facade. The coordinator only needs to send strings
 * and to be told when bytes arrive or the socket closes. Two concrete
 * implementations exist:
 *   - `WsServerConnection`  (apps/server/src/channels/ws-route.ts)
 *   - `InMemoryConnection`  (tests)
 */
export interface ChannelConnection {
  /** Send a JSON-encoded message frame. */
  send(payload: string): void;
  /** Close the underlying socket. */
  close(code?: number, reason?: string): void;
  /** Register the callback for incoming messages. Called exactly once. */
  onMessage(handler: (payload: string) => void): void;
  /** Register the callback for socket close. Called exactly once. */
  onClose(handler: (info: { code?: number; reason?: string }) => void): void;
}

export interface CoordinatorOptions {
  /**
   * Validate the bearer token presented at registration time.
   * Default: compare against `ENSEMBLE_CHANNEL_TOKEN` if set, otherwise
   * accept any non-empty token.
   */
  validateToken?: (token: string | undefined) => boolean;

  /**
   * Default per-dispatch timeout in milliseconds. Individual
   * `sendTurnPrompt` callers can override.
   */
  defaultDispatchTimeoutMs?: number;
}

/** Wire-schema for messages from the bridge. */
const RegisterMessage = z.object({
  type: z.literal("register"),
  session_id: z.string().min(1),
  seat_id: z.string().min(1),
  token: z.string().optional(),
});

const ReplyMessage = z.object({
  type: z.literal("reply"),
  turn_id: z.string().min(1),
  content: z.string(),
  done: z.boolean().default(false),
});

const BridgeMessage = z.discriminatedUnion("type", [
  RegisterMessage,
  ReplyMessage,
]);

type DispatchKey = `${string}::${string}`;

interface PendingDispatch {
  turn_id: string;
  push: (chunk: ReplyChunk) => void;
  fail: (err: Error) => void;
  finish: () => void;
}

interface RegisteredChannel {
  session_id: string;
  seat_id: string;
  conn: ChannelConnection;
  pending: Map<string, PendingDispatch>;
}

function dispatchKey(sessionId: string, seatId: string): DispatchKey {
  return `${sessionId}::${seatId}`;
}

// ─── Coordinator ─────────────────────────────────────────────────────

export class ChannelCoordinator {
  private readonly channels = new Map<DispatchKey, RegisteredChannel>();
  private readonly validateToken: (t: string | undefined) => boolean;
  private readonly defaultDispatchTimeoutMs: number;
  private turnSeq = 0;

  constructor(opts: CoordinatorOptions = {}) {
    this.validateToken =
      opts.validateToken ??
      ((t) => {
        const expected = process.env["ENSEMBLE_CHANNEL_TOKEN"];
        if (expected) return t === expected;
        return typeof t === "string" && t.length > 0;
      });
    this.defaultDispatchTimeoutMs = opts.defaultDispatchTimeoutMs ?? 30_000;
  }

  /**
   * Adopt a freshly-upgraded connection. The coordinator waits for the
   * first `register` message to validate auth + record the (session,
   * seat) binding. Returns when the channel is registered or the
   * connection drops. Does not throw — auth failures close the socket
   * cleanly.
   *
   * `presentedToken` is whatever the upgrade handler extracted from the
   * headers/query (may be undefined). It's checked against the policy
   * configured on the coordinator.
   */
  acceptConnection(
    conn: ChannelConnection,
    presentedToken: string | undefined,
  ): void {
    if (!this.validateToken(presentedToken)) {
      this.sendError(conn, "invalid or missing token");
      conn.close(4401, "unauthorized");
      return;
    }

    let registered: RegisteredChannel | null = null;

    conn.onMessage((payload) => {
      let parsed: z.infer<typeof BridgeMessage>;
      try {
        parsed = BridgeMessage.parse(JSON.parse(payload));
      } catch (err) {
        this.sendError(conn, `malformed message: ${(err as Error).message}`);
        return;
      }

      if (parsed.type === "register") {
        if (registered) {
          this.sendError(conn, "already registered");
          return;
        }
        registered = this.handleRegister(conn, parsed);
        return;
      }

      // reply — must be after register
      if (!registered) {
        this.sendError(conn, "must register before sending replies");
        return;
      }
      this.handleReply(registered, parsed);
    });

    conn.onClose(() => {
      if (!registered) return;
      const key = dispatchKey(registered.session_id, registered.seat_id);
      // Only clear if we're still the current registration (a supersede
      // path may have already replaced us).
      if (this.channels.get(key) === registered) {
        this.channels.delete(key);
      }
      logger.info("channel.close", {
        session_id: registered.session_id,
        seat_id: registered.seat_id,
        pending_count: registered.pending.size,
      });
      // Reject any pending dispatches that were awaiting replies.
      for (const p of registered.pending.values()) {
        p.fail(new ChannelDisconnectedError());
      }
      registered.pending.clear();
    });
  }

  /** True iff a channel is currently registered for this seat. */
  isConnected(sessionId: string, seatId: string): boolean {
    return this.channels.has(dispatchKey(sessionId, seatId));
  }

  /** Generate a unique turn_id. Exposed for tests / debugging. */
  nextTurnId(): string {
    this.turnSeq += 1;
    return `t-${Date.now().toString(36)}-${this.turnSeq}`;
  }

  /**
   * Dispatch a turn-prompt to the bridge for (sessionId, seatId).
   * Returns an `AsyncIterable<ReplyChunk>` of replies streamed from
   * the channel until `done: true`.
   *
   * The iterable throws:
   *   - `ChannelNotConnectedError` immediately if no bridge has
   *     registered for this seat.
   *   - `ChannelDisconnectedError` if the bridge drops mid-stream.
   *   - `ChannelTimeoutError` if no reply (or no `done: true`) arrives
   *     within `timeoutMs`.
   *
   * NOTE: the timeout starts when `sendTurnPrompt` is called, not when
   * iteration begins. Callers that build an iterable but don't iterate
   * will see the prompt sent and any replies buffered.
   */
  sendTurnPrompt(
    sessionId: string,
    seatId: string,
    prompt: string,
    turnId: string = this.nextTurnId(),
    meta: Record<string, unknown> = {},
    timeoutMs: number = this.defaultDispatchTimeoutMs,
  ): AsyncIterable<ReplyChunk> {
    const key = dispatchKey(sessionId, seatId);
    const channel = this.channels.get(key);

    // Build a queue-backed async iterable up front so we can return it
    // even on the not-connected path (where it throws on first next).
    const queue: ReplyChunk[] = [];
    let finished = false;
    let pendingErr: Error | null = null;
    let notify: (() => void) | null = null;

    const push = (chunk: ReplyChunk) => {
      queue.push(chunk);
      if (chunk.done) finished = true;
      notify?.();
    };
    const fail = (err: Error) => {
      pendingErr = err;
      finished = true;
      notify?.();
    };
    const finish = () => {
      finished = true;
      notify?.();
    };

    if (!channel) {
      fail(new ChannelNotConnectedError(sessionId, seatId));
    } else {
      const dispatch: PendingDispatch = { turn_id: turnId, push, fail, finish };
      channel.pending.set(turnId, dispatch);

      const timer = setTimeout(() => {
        if (channel.pending.delete(turnId)) {
          fail(
            new ChannelTimeoutError(
              `no reply with turn_id=${turnId} from channel (session=${sessionId}, seat=${seatId}) within ${timeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs);

      // Wrap fail/finish to also clear the timer & pending entry.
      const origFail = dispatch.fail;
      dispatch.fail = (err) => {
        clearTimeout(timer);
        channel.pending.delete(turnId);
        origFail(err);
      };
      const origFinish = dispatch.finish;
      dispatch.finish = () => {
        clearTimeout(timer);
        channel.pending.delete(turnId);
        origFinish();
      };

      // Send the prompt.
      try {
        channel.conn.send(
          JSON.stringify({
            type: "turn-prompt",
            turn_id: turnId,
            prompt,
            meta,
          }),
        );
      } catch (err) {
        dispatch.fail(
          new ChannelDisconnectedError(
            `failed to send turn-prompt: ${(err as Error).message}`,
          ),
        );
      }
    }

    return {
      [Symbol.asyncIterator]: async function* () {
        while (true) {
          while (queue.length > 0) {
            const chunk = queue.shift()!;
            yield chunk;
            if (chunk.done) return;
          }
          if (pendingErr) throw pendingErr;
          if (finished) return;
          await new Promise<void>((res) => {
            notify = () => {
              notify = null;
              res();
            };
          });
        }
      },
    };
  }

  /**
   * Tear down a channel for a seat. Called by `ChannelRuntime.detach`.
   * Sends a final `unregister` notice; closes the socket.
   */
  unregister(sessionId: string, seatId: string, reason = "detached"): void {
    const key = dispatchKey(sessionId, seatId);
    const channel = this.channels.get(key);
    if (!channel) return;
    try {
      channel.conn.send(JSON.stringify({ type: "unregister", reason }));
    } catch {
      // ignore — we're closing anyway
    }
    channel.conn.close(1000, reason);
    // onClose handler clears `channels` and rejects pending dispatches.
  }

  // ─── internals ─────────────────────────────────────────────────────

  private handleRegister(
    conn: ChannelConnection,
    msg: z.infer<typeof RegisterMessage>,
  ): RegisteredChannel {
    const key = dispatchKey(msg.session_id, msg.seat_id);
    const existing = this.channels.get(key);
    if (existing) {
      // Supersede: fail pending dispatches on the old conn and close it.
      for (const p of existing.pending.values()) {
        p.fail(new ChannelSupersededError());
      }
      existing.pending.clear();
      try {
        existing.conn.send(
          JSON.stringify({ type: "superseded", session_id: msg.session_id, seat_id: msg.seat_id }),
        );
      } catch {
        // ignore
      }
      existing.conn.close(1000, "superseded");
      this.channels.delete(key);
    }

    const channel: RegisteredChannel = {
      session_id: msg.session_id,
      seat_id: msg.seat_id,
      conn,
      pending: new Map(),
    };
    this.channels.set(key, channel);

    logger.info("channel.registered", {
      session_id: msg.session_id,
      seat_id: msg.seat_id,
      superseded: Boolean(existing),
    });

    conn.send(
      JSON.stringify({
        type: "registered",
        session_id: msg.session_id,
        seat_id: msg.seat_id,
      }),
    );
    return channel;
  }

  private handleReply(
    channel: RegisteredChannel,
    msg: z.infer<typeof ReplyMessage>,
  ): void {
    const pending = channel.pending.get(msg.turn_id);
    if (!pending) {
      // No matching dispatch (already completed / timed out / unknown).
      // Silently drop — this is not a fatal protocol error.
      return;
    }
    pending.push({ content: msg.content, done: msg.done });
    if (msg.done) {
      pending.finish();
    }
  }

  private sendError(conn: ChannelConnection, message: string): void {
    try {
      conn.send(JSON.stringify({ type: "error", message }));
    } catch {
      // socket may already be closed
    }
  }
}
