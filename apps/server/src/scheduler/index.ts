import type {
  PersonaRuntime,
  InstanceHandle,
  TurnEvent,
  SeatInfo,
  TurnTakingMode,
} from "@ensemble/shared";

/**
 * Session scheduler. Owns: cast, scenario, turn-taking mode, round
 * counter, event log, cooldowns. Drives the SPI on each seat's runtime.
 *
 * Skeleton — integrator agents fill in their runtime, then we wire the
 * full round loop. This file owns the shape; methods are stubs.
 */
export class SessionScheduler {
  constructor(
    public readonly sessionId: string,
    public readonly mode: TurnTakingMode,
    public readonly seats: SeatInfo[],
    public readonly handles: Map<string, InstanceHandle>,
    public readonly runtimes: Map<string, PersonaRuntime>,
  ) {}

  round = 0;
  private readonly events: TurnEvent[] = [];
  private readonly cooldowns = new Map<string, number>();

  async runRound(): Promise<void> {
    this.round += 1;
    const order = await this.pickOrder();
    for (const seatId of order) {
      await this.runTurn(seatId);
    }
    this.tickCooldowns();
  }

  private async pickOrder(): Promise<string[]> {
    // TODO(scheduler): implement round-robin / shuffled / host-driven / poll
    return this.seats
      .filter((s) => !this.cooldowns.has(s.seat_id))
      .map((s) => s.seat_id);
  }

  private async runTurn(seatId: string): Promise<void> {
    const seat = this.seats.find((s) => s.seat_id === seatId);
    if (!seat) return;
    const runtime = this.runtimes.get(seatId);
    const handle = this.handles.get(seatId);
    if (!runtime || !handle) return;

    let content = "";
    for await (const chunk of runtime.takeTurn(handle, this.events)) {
      content += chunk;
      // TODO(scheduler): emit chunk to UI stream
    }
    this.events.push({
      kind: "turn",
      seat_id: seatId,
      speaker: seat.persona_name,
      content,
      round: this.round,
      timestamp: new Date().toISOString(),
    });
  }

  private tickCooldowns(): void {
    for (const [seat, rounds] of this.cooldowns) {
      if (rounds <= 1) this.cooldowns.delete(seat);
      else this.cooldowns.set(seat, rounds - 1);
    }
  }
}
