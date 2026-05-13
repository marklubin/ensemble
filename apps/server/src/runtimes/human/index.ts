/**
 * HumanRuntime — server-side SPI adapter that represents a human seat.
 *
 * Bridges the SPI's `takeTurn` AsyncIterable<string> contract to the
 * `UiBridge` wire protocol consumed by the web client.
 *
 * Capability set: `{ "streaming" }`. Notably **no** `buzz_check` —
 * the web UI surfaces a "buzz in" button that calls `buzzer.press`
 * directly on the MCP endpoint (Agent G owns that path). The SPI's
 * `buzzCheck` method still returns a well-formed no-buzz response
 * for any caller (e.g. conformance suite) that hits it.
 */

import {
  Capability,
  type BuzzResponse,
  type InstanceHandle,
  type PersonaRuntime,
  type PersonaSpec,
  type SessionContext,
  type TurnEvent,
} from "@ensemble/shared";
import { UiBridge } from "../../ui-bridge/index.ts";
import { logger } from "../../logging/index.ts";

interface HumanHandleInternal {
  id: string;
  seat_id: string;
  session_id: string;
  capabilities: Set<Capability>;
  turnSeq: number;
}

export interface HumanRuntimeOptions {
  /**
   * Maximum time to wait for the human to submit before the turn
   * resolves with whatever content has been streamed so far.
   *
   * `0` or omitted = wait indefinitely (matches the brief's
   * "remain pending until the client connects" behavior). Tests
   * typically pass a small value.
   */
  turnTimeoutMs?: number;
}

export class HumanRuntime implements PersonaRuntime {
  readonly name = "human" as const;
  readonly defaultCapabilities: ReadonlySet<Capability> = new Set([
    "streaming",
  ]);

  private readonly handles = new Map<string, HumanHandleInternal>();

  constructor(
    private readonly bridge: UiBridge,
    private readonly options: HumanRuntimeOptions = {},
  ) {}

  async attach(
    persona: PersonaSpec,
    ctx: SessionContext,
  ): Promise<InstanceHandle> {
    const id = `human-${crypto.randomUUID()}`;
    const internal: HumanHandleInternal = {
      id,
      seat_id: ctx.seat_id,
      session_id: ctx.session_id,
      capabilities: new Set(this.defaultCapabilities),
      turnSeq: 0,
    };
    this.handles.set(id, internal);
    this.bridge.register(ctx.session_id, ctx.seat_id, persona.name);
    logger.info("human.attach", {
      session_id: ctx.session_id,
      seat_id: ctx.seat_id,
      persona_id: persona.id,
      handle_id: id,
    });
    return {
      id,
      seat_id: ctx.seat_id,
      capabilities: internal.capabilities,
    };
  }

  takeTurn(
    handle: InstanceHandle,
    _newEvents: TurnEvent[],
  ): AsyncIterable<string> {
    const internal = this.handles.get(handle.id);
    if (!internal) {
      throw new Error(`HumanRuntime: unknown handle ${handle.id}`);
    }
    internal.turnSeq += 1;
    const turn_id = `${internal.id}-turn-${internal.turnSeq}`;
    const { session_id, seat_id } = internal;
    const bridge = this.bridge;
    const timeoutMs = this.options.turnTimeoutMs ?? 0;

    bridge.emitFocus(session_id, seat_id, turn_id);
    const inbound = bridge.inboundFor(session_id, seat_id, turn_id);
    logger.info("human.waiting_for_input", {
      session_id,
      seat_id,
      turn_id,
    });

    async function* iter(): AsyncIterable<string> {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          bridge.cancelTurn(session_id, seat_id, "timeout");
        }, timeoutMs);
      }
      try {
        for await (const msg of inbound) {
          if (msg.kind === "chunk") {
            if (msg.text.length > 0) {
              logger.debug("human.chunk", {
                session_id,
                seat_id,
                turn_id,
                chunk_length: msg.text.length,
              });
              yield msg.text;
            }
          } else if (msg.kind === "submit") {
            logger.info("human.submit", {
              session_id,
              seat_id,
              turn_id,
            });
            return;
          } else if (msg.kind === "cancel") {
            logger.info("human.cancel", {
              session_id,
              seat_id,
              turn_id,
            });
            return;
          }
          // focus/blur shouldn't arrive from the client, ignore if they do.
        }
        if (timedOut) {
          logger.warn("human.timeout", {
            session_id,
            seat_id,
            turn_id,
            timeout_ms: timeoutMs,
          });
          return;
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        bridge.emitBlur(session_id, seat_id, turn_id);
      }
    }

    return iter();
  }

  async buzzCheck(
    _handle: InstanceHandle,
    _recentTurns: TurnEvent[],
  ): Promise<BuzzResponse> {
    // Capability not declared; the SPI method still resolves a well-formed
    // no-buzz response so conformance suites can assert the shape.
    return { score: 0, intent: "", can_pass: true };
  }

  async detach(handle: InstanceHandle): Promise<void> {
    const internal = this.handles.get(handle.id);
    if (!internal) return;
    this.bridge.unregister(internal.session_id, internal.seat_id);
    this.handles.delete(handle.id);
  }
}
