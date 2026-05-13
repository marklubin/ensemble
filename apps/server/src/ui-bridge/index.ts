/**
 * UiBridge — server side of the human-seat wire protocol.
 *
 * Wire protocol: `UiBridgeMessage` (from `@ensemble/shared`).
 *
 *   client ──POST /ui-bridge/messages──▶ server  (chunk / submit / cancel)
 *   client ◀──SSE /ui-bridge/events──── server  (focus / blur)
 *
 * Public surface used by `HumanRuntime` (server-side, in-process):
 *
 *   bridge.register(session_id, seat_id, persona_name?)
 *   bridge.unregister(session_id, seat_id)
 *   bridge.emitFocus(session_id, seat_id, turn_id)
 *   bridge.emitBlur(session_id, seat_id, turn_id)
 *   bridge.inboundFor(session_id, seat_id, turn_id) → AsyncIterable<UiBridgeMessage>
 *   bridge.routes — Hono sub-app, mount with `app.route("/ui-bridge", bridge.routes)`
 *
 * No-client behavior: `inboundFor` returns a fresh queue immediately. If
 * no client ever POSTs a `submit` or `cancel`, the queue stays pending
 * indefinitely — the caller (HumanRuntime) is responsible for enforcing
 * a timeout or relying on session teardown to call `cancelTurn`.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { UiBridgeMessage } from "@ensemble/shared";
import { AsyncMessageQueue } from "./queue.ts";

type SeatKey = string; // `${session_id}::${seat_id}`

function seatKey(session_id: string, seat_id: string): SeatKey {
  return `${session_id}::${seat_id}`;
}

interface SeatRegistration {
  session_id: string;
  seat_id: string;
  persona_name?: string;
  /** Active turn queue, if a turn is in flight. */
  currentTurn?: { turn_id: string; queue: AsyncMessageQueue };
  /** Outbound SSE subscribers awaiting focus/blur events. */
  subscribers: Set<(ev: OutboundEvent) => void>;
  /** Outbound events emitted before a subscriber attached. */
  pendingOutbound: OutboundEvent[];
}

export type OutboundEvent =
  | { kind: "focus"; seat_id: string; turn_id: string; persona_name?: string }
  | { kind: "blur"; seat_id: string; turn_id: string };

export class UiBridge {
  private readonly seats = new Map<SeatKey, SeatRegistration>();

  /** Hono sub-app exposing the HTTP/SSE surface. */
  readonly routes: Hono;

  constructor() {
    this.routes = this.buildRoutes();
  }

  // ────────────────────────────────────────────────────────────────
  // Registry — HumanRuntime calls these during attach/detach
  // ────────────────────────────────────────────────────────────────

  register(
    session_id: string,
    seat_id: string,
    persona_name?: string,
  ): void {
    const key = seatKey(session_id, seat_id);
    if (this.seats.has(key)) {
      // Re-registration: refresh metadata but keep subscribers + buffer.
      const existing = this.seats.get(key)!;
      existing.persona_name = persona_name ?? existing.persona_name;
      return;
    }
    this.seats.set(key, {
      session_id,
      seat_id,
      persona_name,
      subscribers: new Set(),
      pendingOutbound: [],
    });
  }

  unregister(session_id: string, seat_id: string): void {
    const key = seatKey(session_id, seat_id);
    const reg = this.seats.get(key);
    if (!reg) return;
    // Close any in-flight turn and any SSE subscribers.
    reg.currentTurn?.queue.close();
    for (const sub of reg.subscribers) {
      sub({ kind: "blur", seat_id, turn_id: reg.currentTurn?.turn_id ?? "" });
    }
    reg.subscribers.clear();
    this.seats.delete(key);
  }

  /** Whether a seat is currently registered. */
  has(session_id: string, seat_id: string): boolean {
    return this.seats.has(seatKey(session_id, seat_id));
  }

  // ────────────────────────────────────────────────────────────────
  // Outbound — runtime → client (focus / blur)
  // ────────────────────────────────────────────────────────────────

  emitFocus(session_id: string, seat_id: string, turn_id: string): void {
    const reg = this.requireSeat(session_id, seat_id);
    const ev: OutboundEvent = {
      kind: "focus",
      seat_id,
      turn_id,
      persona_name: reg.persona_name,
    };
    this.dispatchOutbound(reg, ev);
  }

  emitBlur(session_id: string, seat_id: string, turn_id: string): void {
    const reg = this.seats.get(seatKey(session_id, seat_id));
    if (!reg) return;
    this.dispatchOutbound(reg, { kind: "blur", seat_id, turn_id });
  }

  private dispatchOutbound(reg: SeatRegistration, ev: OutboundEvent): void {
    if (reg.subscribers.size === 0) {
      // Buffer until a subscriber attaches, capped to avoid leaks.
      reg.pendingOutbound.push(ev);
      if (reg.pendingOutbound.length > 64) reg.pendingOutbound.shift();
      return;
    }
    for (const sub of reg.subscribers) {
      try {
        sub(ev);
      } catch {
        // Subscriber errors don't break the dispatcher.
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Inbound — HumanRuntime consumes the message stream for a turn
  // ────────────────────────────────────────────────────────────────

  /**
   * Begin a turn on this seat. Returns an AsyncIterable that yields
   * UiBridgeMessages posted by the client for this seat+turn. Iterator
   * completes when a `submit` or `cancel` is received, or when the seat
   * is unregistered.
   *
   * Only one in-flight turn per seat is supported; calling again with a
   * new turn_id implicitly cancels any prior queue.
   */
  inboundFor(
    session_id: string,
    seat_id: string,
    turn_id: string,
  ): AsyncIterable<UiBridgeMessage> {
    const reg = this.requireSeat(session_id, seat_id);
    if (reg.currentTurn && reg.currentTurn.turn_id !== turn_id) {
      reg.currentTurn.queue.cancel("superseded");
    }
    const queue = new AsyncMessageQueue();
    reg.currentTurn = { turn_id, queue };
    return queue;
  }

  /** Cancel the in-flight turn for a seat, if any. */
  cancelTurn(session_id: string, seat_id: string, reason?: string): void {
    const reg = this.seats.get(seatKey(session_id, seat_id));
    if (!reg || !reg.currentTurn) return;
    reg.currentTurn.queue.cancel(reason);
    reg.currentTurn = undefined;
  }

  /** End the in-flight turn for a seat (called by runtime after submit). */
  endTurn(session_id: string, seat_id: string): void {
    const reg = this.seats.get(seatKey(session_id, seat_id));
    if (!reg || !reg.currentTurn) return;
    reg.currentTurn.queue.close();
    reg.currentTurn = undefined;
  }

  // ────────────────────────────────────────────────────────────────
  // HTTP transport
  // ────────────────────────────────────────────────────────────────

  /**
   * Handle an inbound message from the client. Exposed publicly so
   * tests (and any in-process producer) can bypass HTTP framing.
   */
  ingest(msg: UiBridgeMessage, session_id: string): boolean {
    const reg = this.seats.get(seatKey(session_id, msg.seat_id));
    if (!reg || !reg.currentTurn) return false;
    if (reg.currentTurn.turn_id !== msg.turn_id) return false;
    reg.currentTurn.queue.push(msg);
    if (msg.kind === "submit") {
      reg.currentTurn.queue.close();
      reg.currentTurn = undefined;
    } else if (msg.kind === "cancel") {
      reg.currentTurn.queue.cancel(msg.reason);
      reg.currentTurn = undefined;
    }
    return true;
  }

  private requireSeat(
    session_id: string,
    seat_id: string,
  ): SeatRegistration {
    const reg = this.seats.get(seatKey(session_id, seat_id));
    if (!reg) {
      throw new Error(
        `UiBridge: seat not registered (session=${session_id}, seat=${seat_id})`,
      );
    }
    return reg;
  }

  private buildRoutes(): Hono {
    const app = new Hono();

    // POST /ui-bridge/messages
    // Body: { session_id, message: UiBridgeMessage }
    app.post("/messages", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_json" }, 400);
      }
      const envelope = z
        .object({
          session_id: z.string(),
          message: UiBridgeMessage,
        })
        .safeParse(body);
      if (!envelope.success) {
        return c.json(
          { error: "invalid_payload", issues: envelope.error.issues },
          400,
        );
      }
      const accepted = this.ingest(envelope.data.message, envelope.data.session_id);
      if (!accepted) {
        return c.json({ error: "no_active_turn" }, 409);
      }
      return c.json({ ok: true });
    });

    // GET /ui-bridge/events?session_id=...&seat_id=...
    app.get("/events", (c) => {
      const session_id = c.req.query("session_id");
      const seat_id = c.req.query("seat_id");
      if (!session_id || !seat_id) {
        return c.json({ error: "missing_query_params" }, 400);
      }
      const reg = this.seats.get(seatKey(session_id, seat_id));
      if (!reg) {
        return c.json({ error: "seat_not_registered" }, 404);
      }

      return streamSSE(c, async (stream) => {
        const queued: OutboundEvent[] = [];
        let resolveNext: (() => void) | null = null;

        const handler = (ev: OutboundEvent) => {
          queued.push(ev);
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r();
          }
        };
        reg.subscribers.add(handler);

        // Flush any pending outbound events that fired before subscription.
        if (reg.pendingOutbound.length > 0) {
          queued.push(...reg.pendingOutbound);
          reg.pendingOutbound = [];
        }

        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
          reg.subscribers.delete(handler);
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r();
          }
        });

        try {
          // Send an initial hello so the client knows it's connected.
          await stream.writeSSE({ event: "ready", data: JSON.stringify({ seat_id, session_id }) });

          while (!aborted) {
            while (queued.length > 0) {
              const ev = queued.shift()!;
              await stream.writeSSE({
                event: ev.kind,
                data: JSON.stringify(ev),
              });
            }
            if (aborted) break;
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }
        } finally {
          reg.subscribers.delete(handler);
        }
      });
    });

    return app;
  }
}

