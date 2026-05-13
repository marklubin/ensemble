import type {
  BuzzResponse,
  Capability,
  InstanceHandle,
  PersonaRuntime,
  PersonaSpec,
  SessionContext,
  TurnEvent,
} from "@ensemble/shared";

/**
 * A deterministic, in-memory `PersonaRuntime` used in scheduler
 * integration tests. It scripts:
 *  - which chunks each turn yields (by seat_id, in call order)
 *  - which BuzzResponse each buzzCheck returns (by seat_id, in call order)
 *
 * Records every interaction so tests can assert ordering and replay.
 * Mirrors enough of the SPI to exercise the scheduler end-to-end
 * without any real runtime.
 *
 * Lives here (rather than in @ensemble/spi-conformance) because it's
 * tailored to scheduler tests; the conformance suite gets its own
 * fixture factory contract.
 */

export interface RecordedTurn {
  seat_id: string;
  chunks: readonly string[];
  /** Concatenated text the runtime would have streamed. */
  full_text: string;
  receivedEvents: number;
  call_index: number;
}

export interface RecordedBuzz {
  seat_id: string;
  response: BuzzResponse;
  call_index: number;
}

export interface RecordedRuntimeScript {
  /**
   * For each seat, an ordered list of chunk arrays. The Nth call to
   * `takeTurn` for seat S consumes the Nth entry. Falling off the
   * end yields `["<seat> done"]`.
   */
  turnChunks?: Record<string, readonly (readonly string[])[]>;
  /**
   * For each seat, an ordered list of BuzzResponses. The Nth call to
   * `buzzCheck` for seat S consumes the Nth entry. Falling off the
   * end returns `{ score: 0, intent: "", can_pass: true }`.
   */
  buzzResponses?: Record<string, readonly BuzzResponse[]>;
  /** Capabilities every produced InstanceHandle advertises. */
  capabilities?: ReadonlySet<Capability>;
  /** Default name reported by the runtime. */
  name?: string;
}

const DEFAULT_CAPS: ReadonlySet<Capability> = new Set([
  "streaming",
  "buzz_check",
]);

export class RecordedRuntime implements PersonaRuntime {
  readonly name: string;
  readonly defaultCapabilities: ReadonlySet<Capability>;

  readonly attached: Array<{ seat_id: string; persona_id: string }> = [];
  readonly detached: string[] = [];
  readonly turns: RecordedTurn[] = [];
  readonly buzzes: RecordedBuzz[] = [];

  private turnCounters = new Map<string, number>();
  private buzzCounters = new Map<string, number>();
  private globalTurnCounter = 0;
  private globalBuzzCounter = 0;
  private handles = new Map<string, InstanceHandle>();

  constructor(private readonly script: RecordedRuntimeScript = {}) {
    this.name = script.name ?? "recorded";
    this.defaultCapabilities = script.capabilities ?? DEFAULT_CAPS;
  }

  async attach(
    persona: PersonaSpec,
    ctx: SessionContext,
  ): Promise<InstanceHandle> {
    const handle: InstanceHandle = {
      id: `${ctx.seat_id}-handle-${this.attached.length}`,
      seat_id: ctx.seat_id,
      capabilities: this.defaultCapabilities,
    };
    this.attached.push({ seat_id: ctx.seat_id, persona_id: persona.id });
    this.handles.set(ctx.seat_id, handle);
    return handle;
  }

  async *takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string> {
    const seat = handle.seat_id;
    const callIdx = this.turnCounters.get(seat) ?? 0;
    this.turnCounters.set(seat, callIdx + 1);

    const scripted = this.script.turnChunks?.[seat]?.[callIdx];
    const chunks: readonly string[] = scripted ?? [`<${seat}#${callIdx}>`];

    const recorded: RecordedTurn = {
      seat_id: seat,
      chunks: [...chunks],
      full_text: chunks.join(""),
      receivedEvents: newEvents.length,
      call_index: this.globalTurnCounter++,
    };
    this.turns.push(recorded);

    for (const ch of chunks) {
      yield ch;
    }
  }

  async buzzCheck(
    handle: InstanceHandle,
    _recentTurns: TurnEvent[],
  ): Promise<BuzzResponse> {
    const seat = handle.seat_id;
    const callIdx = this.buzzCounters.get(seat) ?? 0;
    this.buzzCounters.set(seat, callIdx + 1);

    const scripted = this.script.buzzResponses?.[seat]?.[callIdx];
    const response: BuzzResponse = scripted ?? {
      score: 0,
      intent: "",
      can_pass: true,
    };
    this.buzzes.push({
      seat_id: seat,
      response,
      call_index: this.globalBuzzCounter++,
    });
    return response;
  }

  async detach(handle: InstanceHandle): Promise<void> {
    this.detached.push(handle.seat_id);
    this.handles.delete(handle.seat_id);
  }
}
