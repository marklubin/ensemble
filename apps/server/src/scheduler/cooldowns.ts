/**
 * Cooldown tracking. After a seat speaks, it's put on cooldown for
 * `cooldown_rounds` (default 1). At the end of each round, every
 * cooldown's rounds-remaining count is decremented; seats that reach
 * 0 are removed from the map and become eligible again.
 *
 * Stored as a Map<seat_id, rounds_remaining>. A seat absent from the
 * map is eligible. Rounds-remaining is always > 0 while present.
 */
export class CooldownTracker {
  private readonly map = new Map<string, number>();

  /** Returns the current cooldown rounds for a seat, or 0 if eligible. */
  get(seatId: string): number {
    return this.map.get(seatId) ?? 0;
  }

  /** True iff the seat is eligible to speak this round. */
  isEligible(seatId: string): boolean {
    return this.get(seatId) <= 0;
  }

  /**
   * Put a seat on cooldown for N rounds (N >= 1). If the seat is
   * already on cooldown, the longer of the two values wins.
   */
  apply(seatId: string, rounds: number): void {
    if (rounds <= 0) return;
    const current = this.map.get(seatId) ?? 0;
    if (rounds > current) {
      this.map.set(seatId, rounds);
    }
  }

  /**
   * Decrement every active cooldown by one. Returns the seat ids
   * whose cooldown reached zero this tick (useful for emitting an
   * event log line).
   */
  tick(): string[] {
    const cleared: string[] = [];
    for (const [seat, rounds] of [...this.map]) {
      if (rounds <= 1) {
        this.map.delete(seat);
        cleared.push(seat);
      } else {
        this.map.set(seat, rounds - 1);
      }
    }
    return cleared;
  }

  /** Snapshot for read-only consumers (e.g. the picker). */
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.map);
  }

  /** Clear all cooldowns (used at session end and in tests). */
  clear(): void {
    this.map.clear();
  }

  /** Bypass a seat for one round without applying a longer cooldown. */
  bypass(seatId: string): void {
    this.apply(seatId, 1);
  }
}
