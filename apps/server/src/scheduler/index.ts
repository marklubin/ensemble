import type {
  BuzzResponse,
  InstanceHandle,
  PersonaRuntime,
  SeatInfo,
  SseEvent,
  TurnEvent,
  TurnTakingMode,
} from "@ensemble/shared";

import { CooldownTracker } from "./cooldowns.ts";
import { EventBus } from "./event-bus.ts";
import { pickOrder, type PollResult } from "./pick-order.ts";

export { EventBus } from "./event-bus.ts";
export { CooldownTracker } from "./cooldowns.ts";
export {
  pickOrder,
  eligibleSeats,
  shuffle,
  pickPollWinner,
} from "./pick-order.ts";
export type { PollResult, PickOrderInput } from "./pick-order.ts";

/**
 * Session length — `open-ended` runs until `end()` is called.
 * `n_rounds=N` runs N rounds and then ends with `n-rounds-reached`.
 */
export type SessionLength =
  | { kind: "open-ended" }
  | { kind: "n_rounds"; n: number };

export interface SchedulerOptions {
  sessionId: string;
  mode: TurnTakingMode;
  seats: readonly SeatInfo[];
  handles: ReadonlyMap<string, InstanceHandle>;
  runtimes: ReadonlyMap<string, PersonaRuntime>;
  bus: EventBus;
  length?: SessionLength;
  /** Default cooldown rounds applied after a seat speaks. */
  cooldownRounds?: number;
  /** Seat id of the host (host-driven mode). */
  hostSeatId?: string;
  /**
   * Hook to obtain the host's pick in host-driven mode. Returns
   * `null` to let the picker fall back. Receives the eligible
   * seats so the host can choose.
   */
  hostPicker?: (eligible: readonly string[]) => Promise<string | null>;
  /** Quiet bias added to poll scores per round-since-spoke (default 0). */
  quietBias?: number;
  /** RNG (test injection). */
  rng?: () => number;
  /** ISO timestamp factory (test injection). */
  now?: () => string;
  /** Used by poll mode for fetching the most-recent K turns to feed buzzCheck. */
  buzzContextWindow?: number;
}

export type SessionEndReason = "user" | "n-rounds-reached" | "moderator";

/**
 * The SessionScheduler owns the run loop, cooldowns, the seat order
 * picker, and the per-seat last-seen-event cursor. Every state
 * transition emits an `SseEvent` onto the bus.
 *
 * Lifecycle:
 *   1. construct with the seats + runtimes + bus
 *   2. start() — emits session.start, then runs runSession()
 *   3. runSession() loops runRound() until length is reached
 *   4. end(reason) — emits session.end and breaks the run loop
 *
 * The scheduler does NOT call attach/detach on the runtimes — that's
 * the caller's responsibility (so the session route can attach before
 * starting and the orchestrator can swap runtimes during tests).
 */
export class SessionScheduler {
  public round = 0;
  public readonly sessionId: string;
  public readonly mode: TurnTakingMode;
  public readonly seats: readonly SeatInfo[];
  public readonly bus: EventBus;
  public readonly length: SessionLength;

  private readonly handles: ReadonlyMap<string, InstanceHandle>;
  private readonly runtimes: ReadonlyMap<string, PersonaRuntime>;
  private readonly cooldowns = new CooldownTracker();
  private readonly cooldownRounds: number;
  private readonly hostSeatId?: string;
  private readonly hostPicker?: (
    eligible: readonly string[],
  ) => Promise<string | null>;
  private readonly quietBias: number;
  private readonly rng: () => number;
  private readonly now: () => string;
  private readonly buzzContextWindow: number;

  /** Per-seat cursor: number of events that seat has already seen. */
  private readonly seenCount = new Map<string, number>();
  /** Per-seat last-spoke round (for quiet bias). */
  private readonly lastSpokeRound = new Map<string, number>();
  /** Buzz intents the picker chose, forwarded into the next takeTurn as a moderator event. */
  private pendingBuzzIntent: { seat_id: string; intent: string } | null = null;
  /** Forced speaker (moderator.force_speaker) honored on next pick. */
  private forcedSpeaker: string | null = null;
  /** Append-only event log shared across seats. */
  private readonly events: TurnEvent[] = [];
  private running = false;
  private endRequested: SessionEndReason | null = null;
  private turnCounter = 0;

  constructor(opts: SchedulerOptions) {
    this.sessionId = opts.sessionId;
    this.mode = opts.mode;
    this.seats = opts.seats;
    this.handles = opts.handles;
    this.runtimes = opts.runtimes;
    this.bus = opts.bus;
    this.length = opts.length ?? { kind: "open-ended" };
    this.cooldownRounds = opts.cooldownRounds ?? 1;
    this.hostSeatId = opts.hostSeatId;
    this.hostPicker = opts.hostPicker;
    this.quietBias = opts.quietBias ?? 0;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.buzzContextWindow = opts.buzzContextWindow ?? 3;
  }

  /** Append-only event log (read-only view). */
  get eventLog(): readonly TurnEvent[] {
    return this.events;
  }

  /** Current cooldown snapshot. */
  cooldownSnapshot(): ReadonlyMap<string, number> {
    return this.cooldowns.snapshot();
  }

  // ── External controls ────────────────────────────────────────────

  /** Apply a moderator cooldown. */
  applyCooldown(seatId: string, rounds: number, reason: string): void {
    this.cooldowns.apply(seatId, rounds);
    this.events.push({
      kind: "cooldown",
      seat_id: seatId,
      rounds,
      reason,
      timestamp: this.now(),
    });
    this.bus.publish({
      type: "cooldown.applied",
      session_id: this.sessionId,
      seat_id: seatId,
      rounds,
      reason,
      timestamp: this.now(),
    });
  }

  /** Moderator: force a specific seat as the next speaker. */
  forceSpeaker(seatId: string): void {
    this.forcedSpeaker = seatId;
  }

  /** Moderator: inject a moderator message into the transcript. */
  injectModeratorMessage(content: string): void {
    this.events.push({
      kind: "moderator",
      content,
      round: this.round,
      timestamp: this.now(),
    });
    this.bus.publish({
      type: "moderator.message",
      session_id: this.sessionId,
      round: this.round,
      content,
      timestamp: this.now(),
    });
  }

  /** Request graceful end. The loop finishes the in-flight turn then stops. */
  requestEnd(reason: SessionEndReason = "user"): void {
    this.endRequested = reason;
  }

  /** Was end requested? */
  get isEndRequested(): boolean {
    return this.endRequested !== null;
  }

  // ── Run loop ─────────────────────────────────────────────────────

  /** Start the session: emit session.start, run rounds, end gracefully. */
  async start(): Promise<void> {
    if (this.running) throw new Error("Scheduler already started");
    this.running = true;
    this.bus.publish({
      type: "session.start",
      session_id: this.sessionId,
      timestamp: this.now(),
    });
    try {
      await this.runSession();
    } finally {
      const reason = this.endRequested ?? "user";
      this.bus.publish({
        type: "session.end",
        session_id: this.sessionId,
        ended_by: reason,
        timestamp: this.now(),
      });
      this.running = false;
    }
  }

  /** Drive rounds until the configured length or an end request. */
  async runSession(): Promise<void> {
    while (!this.endRequested) {
      if (
        this.length.kind === "n_rounds" &&
        this.round >= this.length.n
      ) {
        this.endRequested = "n-rounds-reached";
        break;
      }
      await this.runRound();
    }
  }

  /** Run one round: pick order, take each turn, tick cooldowns. */
  async runRound(): Promise<void> {
    this.round += 1;

    const order = await this.computeOrder();
    this.bus.publish({
      type: "round.start",
      session_id: this.sessionId,
      round: this.round,
      order,
      timestamp: this.now(),
    });

    for (const seatId of order) {
      if (this.endRequested) break;
      // Re-check eligibility for each turn — earlier turns may have
      // applied cooldowns or bypasses.
      if (!this.cooldowns.isEligible(seatId)) {
        this.bus.publish({
          type: "seat.bypassed",
          session_id: this.sessionId,
          seat_id: seatId,
          round: this.round,
          reason: "cooldown",
          timestamp: this.now(),
        });
        continue;
      }
      await this.runTurn(seatId);
      // Apply default cooldown after speaking.
      if (this.cooldownRounds > 0) {
        this.cooldowns.apply(seatId, this.cooldownRounds);
      }
      this.lastSpokeRound.set(seatId, this.round);
    }

    this.bus.publish({
      type: "round.end",
      session_id: this.sessionId,
      round: this.round,
      timestamp: this.now(),
    });
    this.cooldowns.tick();
  }

  // ── Order selection ──────────────────────────────────────────────

  private async computeOrder(): Promise<string[]> {
    // 1. Forced speaker wins, regardless of mode.
    if (this.forcedSpeaker) {
      const forced = this.forcedSpeaker;
      this.forcedSpeaker = null;
      if (this.seats.some((s) => s.seat_id === forced)) {
        return [forced];
      }
    }
    const seatIds = this.seats.map((s) => s.seat_id);
    const cd = this.cooldowns.snapshot();

    if (this.mode === "poll") {
      const pollResults = await this.collectPollResults(seatIds, cd);
      const winner = pickOrder({
        mode: "poll",
        seats: seatIds,
        cooldowns: cd,
        pollResults,
        quietBias: this.quietBias,
        rng: this.rng,
      });
      // Forward the winning intent into the next takeTurn.
      const win = pollResults.find((r) => r.seat_id === winner[0]);
      if (win) {
        this.pendingBuzzIntent = { seat_id: win.seat_id, intent: win.intent };
      }
      return winner;
    }

    if (this.mode === "host-driven") {
      const eligible = seatIds.filter((s) => (cd.get(s) ?? 0) <= 0);
      const hostPick = this.hostPicker
        ? await this.hostPicker(eligible)
        : null;
      return pickOrder({
        mode: "host-driven",
        seats: seatIds,
        cooldowns: cd,
        hostSeatId: this.hostSeatId,
        hostPick: hostPick ?? undefined,
        rng: this.rng,
      });
    }

    return pickOrder({
      mode: this.mode,
      seats: seatIds,
      cooldowns: cd,
      rng: this.rng,
    });
  }

  private async collectPollResults(
    seatIds: readonly string[],
    cd: ReadonlyMap<string, number>,
  ): Promise<PollResult[]> {
    const recent = this.recentTurns(this.buzzContextWindow);
    const polls = seatIds
      .filter((s) => (cd.get(s) ?? 0) <= 0)
      .map(async (seat): Promise<PollResult | null> => {
        const runtime = this.runtimes.get(seat);
        const handle = this.handles.get(seat);
        if (!runtime || !handle) return null;
        if (!handle.capabilities.has("buzz_check")) return null;
        try {
          const r: BuzzResponse = await runtime.buzzCheck(handle, recent);
          return {
            seat_id: seat,
            score: r.score,
            intent: r.intent,
            rounds_since_spoke:
              this.round - (this.lastSpokeRound.get(seat) ?? -1),
          };
        } catch {
          return null;
        }
      });
    const settled = await Promise.all(polls);
    return settled.filter((r): r is PollResult => r !== null);
  }

  // ── Single turn ──────────────────────────────────────────────────

  private async runTurn(seatId: string): Promise<void> {
    const seat = this.seats.find((s) => s.seat_id === seatId);
    if (!seat) return;
    const runtime = this.runtimes.get(seatId);
    const handle = this.handles.get(seatId);
    if (!runtime || !handle) {
      this.bus.publish({
        type: "seat.bypassed",
        session_id: this.sessionId,
        seat_id: seatId,
        round: this.round,
        reason: "no-runtime",
        timestamp: this.now(),
      });
      return;
    }

    const turnId = `t${++this.turnCounter}`;
    this.bus.publish({
      type: "turn.start",
      session_id: this.sessionId,
      seat_id: seatId,
      speaker: seat.persona_name,
      round: this.round,
      turn_id: turnId,
      timestamp: this.now(),
    });

    const newEvents = this.unseenEventsFor(seatId);
    // Optional: forward the poll-winning intent as a moderator-style hint.
    if (
      this.pendingBuzzIntent &&
      this.pendingBuzzIntent.seat_id === seatId
    ) {
      newEvents.push({
        kind: "moderator",
        content: `(buzz intent) ${this.pendingBuzzIntent.intent}`,
        round: this.round,
        timestamp: this.now(),
      });
      this.pendingBuzzIntent = null;
    }

    let full = "";
    try {
      for await (const chunk of runtime.takeTurn(handle, newEvents)) {
        full += chunk;
        this.bus.publish({
          type: "turn.delta",
          session_id: this.sessionId,
          turn_id: turnId,
          text: chunk,
        });
      }
    } catch (err) {
      this.bus.publish({
        type: "tool.status",
        session_id: this.sessionId,
        seat_id: seatId,
        tool: "takeTurn",
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
        timestamp: this.now(),
      });
    }

    this.markSeenThrough(seatId, this.events.length);
    const ts = this.now();
    this.events.push({
      kind: "turn",
      seat_id: seatId,
      speaker: seat.persona_name,
      content: full,
      round: this.round,
      timestamp: ts,
    });
    // The speaker has "seen" their own utterance going forward.
    this.markSeenThrough(seatId, this.events.length);

    this.bus.publish({
      type: "turn.end",
      session_id: this.sessionId,
      turn_id: turnId,
      seat_id: seatId,
      full_text: full,
      timestamp: ts,
    });
  }

  /** Events seat has NOT yet seen (since their last takeTurn). */
  private unseenEventsFor(seatId: string): TurnEvent[] {
    const cursor = this.seenCount.get(seatId) ?? 0;
    return this.events.slice(cursor);
  }

  private markSeenThrough(seatId: string, count: number): void {
    this.seenCount.set(seatId, count);
  }

  /** Most-recent K turn events (used to feed buzzCheck context). */
  private recentTurns(k: number): TurnEvent[] {
    if (k <= 0) return [];
    return this.events.slice(-k);
  }
}

/**
 * Convenience: build an SseEvent.session.start envelope without
 * needing to import the type. Re-exported so the session route can
 * cleanly emit a single canonical shape.
 */
export function makeSessionStartEvent(
  sessionId: string,
  now: () => string = () => new Date().toISOString(),
): SseEvent {
  return {
    type: "session.start",
    session_id: sessionId,
    timestamp: now(),
  };
}
