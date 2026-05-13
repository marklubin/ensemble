import type {
  BuzzerPressInput,
  BuzzerPassInput,
  CastListInput,
  HostApiToolName,
  MemoryListInput,
  MemoryReadInput,
  MemoryWriteInput,
  ModBypassInput,
  ModCooldownInput,
  ModForceSpeakerInput,
  ModInjectInput,
  RoundInfoInput,
  SeatInfo,
  TurnTakingMode,
} from "@ensemble/shared";

/**
 * MockHostApi — an in-memory implementation of every Host API tool.
 *
 * The conformance suite hands one of these to a runtime factory so
 * that when the runtime's persona "calls" `memory.write` (via
 * whatever fixture mechanism the runtime uses), the suite can assert
 * the call landed on this mock by inspecting its records.
 *
 * Runtime fixture factories MAY:
 *   - Construct a `MockHostApi`.
 *   - Wire their runtime so tool calls dispatch into it.
 *   - Hand the MockHostApi reference back to the conformance suite
 *     (via the factory return value) for assertions.
 *
 * Output shapes mirror the real Host API server (Agent B).
 */

export interface ToolCallRecord {
  tool: HostApiToolName;
  seat_id: string;
  args: unknown;
  result: unknown;
  /** Monotonic call index (across all tools) for ordering assertions. */
  order: number;
  timestamp: string;
}

export interface BuzzCall {
  seat_id: string;
  intensity: number;
  intent: string;
  call_index: number;
}

export interface PassCall {
  seat_id: string;
  reason?: string;
  call_index: number;
}

export interface MockHostApiOptions {
  /** Required: cast for cast.list responses. */
  cast?: SeatInfo[];
  /** Required: current round metadata for round.info responses. */
  round?: {
    round: number;
    mode: TurnTakingMode;
  };
  /** Map of seat_id → cooldown rounds remaining. */
  cooldowns?: Map<string, number>;
  /** Pre-populated memory keyed by seat_id. */
  initialMemory?: Map<string, Record<string, unknown>>;
}

export class MockHostApi {
  readonly calls: ToolCallRecord[] = [];
  readonly buzzes: BuzzCall[] = [];
  readonly passes: PassCall[] = [];
  /** Force-speaker calls (recorded for moderator assertions). */
  readonly forceSpeakerCalls: Array<{ seat_id: string }> = [];
  readonly cooldownCalls: Array<{ seat_id: string; rounds: number; reason: string }> = [];
  readonly bypassCalls: Array<{ seat_id: string; reason: string }> = [];
  readonly injectCalls: number[] = [];

  private cast: SeatInfo[];
  private round: { round: number; mode: TurnTakingMode };
  private cooldowns: Map<string, number>;
  private memory: Map<string, Map<string, unknown>>;
  private order = 0;
  private buzzCounter = 0;
  private passCounter = 0;

  constructor(opts: MockHostApiOptions = {}) {
    this.cast = opts.cast ?? [];
    this.round = opts.round ?? { round: 1, mode: "round-robin" };
    this.cooldowns = opts.cooldowns ?? new Map();
    this.memory = new Map();
    if (opts.initialMemory) {
      for (const [seat, kv] of opts.initialMemory) {
        this.memory.set(seat, new Map(Object.entries(kv)));
      }
    }
  }

  // ─── Tool dispatch ───────────────────────────────────────────────

  async call(
    seatId: string,
    tool: HostApiToolName,
    args: unknown,
  ): Promise<unknown> {
    const result = await this.dispatch(seatId, tool, args);
    this.calls.push({
      tool,
      seat_id: seatId,
      args,
      result,
      order: this.order++,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  private async dispatch(
    seatId: string,
    tool: HostApiToolName,
    args: unknown,
  ): Promise<unknown> {
    switch (tool) {
      case "buzzer.press": {
        const a = args as BuzzerPressInput;
        this.buzzes.push({
          seat_id: seatId,
          intensity: a.intensity,
          intent: a.intent,
          call_index: this.buzzCounter++,
        });
        return { ok: true };
      }
      case "buzzer.pass": {
        const a = args as BuzzerPassInput;
        this.passes.push({
          seat_id: seatId,
          reason: a.reason,
          call_index: this.passCounter++,
        });
        return { ok: true };
      }
      case "memory.write": {
        const a = args as MemoryWriteInput;
        if (!this.memory.has(seatId)) this.memory.set(seatId, new Map());
        this.memory.get(seatId)!.set(a.key, a.value);
        return { ok: true };
      }
      case "memory.read": {
        const a = args as MemoryReadInput;
        const v = this.memory.get(seatId)?.get(a.key);
        return { value: v ?? null };
      }
      case "memory.list": {
        const _a = args as MemoryListInput;
        return { keys: [...(this.memory.get(seatId)?.keys() ?? [])] };
      }
      case "cast.list": {
        const _a = args as CastListInput;
        return { cast: this.cast };
      }
      case "round.info": {
        const _a = args as RoundInfoInput;
        return {
          round: this.round.round,
          mode: this.round.mode,
          your_cooldown: this.cooldowns.get(seatId) ?? 0,
        };
      }
      case "moderator.force_speaker": {
        const a = args as ModForceSpeakerInput;
        this.forceSpeakerCalls.push({ seat_id: a.seat_id });
        return { ok: true };
      }
      case "moderator.cooldown": {
        const a = args as ModCooldownInput;
        this.cooldownCalls.push({
          seat_id: a.seat_id,
          rounds: a.rounds,
          reason: a.reason,
        });
        this.cooldowns.set(
          a.seat_id,
          Math.max(this.cooldowns.get(a.seat_id) ?? 0, a.rounds),
        );
        return { ok: true };
      }
      case "moderator.bypass": {
        const a = args as ModBypassInput;
        this.bypassCalls.push({ seat_id: a.seat_id, reason: a.reason });
        return { ok: true };
      }
      case "moderator.inject": {
        const _a = args as ModInjectInput;
        this.injectCalls.push(this.order);
        return { ok: true };
      }
    }
  }

  // ─── Inspection helpers ──────────────────────────────────────────

  callsForSeat(seatId: string): ToolCallRecord[] {
    return this.calls.filter((c) => c.seat_id === seatId);
  }

  callsForTool(tool: HostApiToolName): ToolCallRecord[] {
    return this.calls.filter((c) => c.tool === tool);
  }

  memoryFor(seatId: string): Record<string, unknown> {
    const m = this.memory.get(seatId);
    if (!m) return {};
    return Object.fromEntries(m);
  }

  // ─── Mutation helpers (for fixture authors) ─────────────────────

  setCast(cast: SeatInfo[]): void {
    this.cast = cast;
  }

  setRound(round: number, mode: TurnTakingMode): void {
    this.round = { round, mode };
  }

  setCooldown(seatId: string, rounds: number): void {
    if (rounds <= 0) this.cooldowns.delete(seatId);
    else this.cooldowns.set(seatId, rounds);
  }
}
