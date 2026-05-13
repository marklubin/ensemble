import type { TurnTakingMode } from "@ensemble/shared";

/**
 * Pure functions that decide who speaks next, given the session's
 * turn-taking mode, the seat list, and the current cooldown state.
 *
 * Kept here (separate from the SessionScheduler class) so it can be
 * unit-tested at 100% branch coverage without spinning up runtimes,
 * event buses, or async machinery.
 */

export interface PollResult {
  seat_id: string;
  score: number;
  intent: string;
  /**
   * How many rounds since this seat last spoke (used for quiet-bias
   * tie-breaks). 0 means they just spoke; high values are quieter.
   */
  rounds_since_spoke?: number;
}

export interface PickOrderInput {
  mode: TurnTakingMode;
  /** Seat ids in their canonical (initial) order. */
  seats: readonly string[];
  /** Map of seat_id → cooldown rounds remaining. Missing = eligible. */
  cooldowns: ReadonlyMap<string, number>;
  /** When the mode is `host-driven`, the seat to consult. */
  hostSeatId?: string;
  /**
   * When the mode is `host-driven`, the host's pick. If unset or not
   * eligible, the picker falls back to round-robin among the
   * remaining seats so the round still advances.
   */
  hostPick?: string;
  /**
   * When the mode is `poll`, the buzz responses gathered from every
   * eligible seat (failed/unavailable seats may be omitted).
   */
  pollResults?: readonly PollResult[];
  /**
   * Optional bias: boosts seats that haven't spoken for at least this
   * many rounds. Set to 0 (default) to disable.
   */
  quietBias?: number;
  /** RNG injected so tests can be deterministic. Defaults to Math.random. */
  rng?: () => number;
}

/**
 * Filter to the seats that may speak this round (not on cooldown).
 * The list preserves the canonical ordering passed in.
 */
export function eligibleSeats(
  seats: readonly string[],
  cooldowns: ReadonlyMap<string, number>,
): string[] {
  return seats.filter((s) => (cooldowns.get(s) ?? 0) <= 0);
}

/**
 * Deterministic Fisher–Yates shuffle. Uses the provided RNG so tests
 * can stub it; defaults to Math.random.
 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Pick the winner of a poll. Highest score wins. Optional quiet bias
 * adds a small bump per round-since-spoke. Ties broken by quietness,
 * then by deterministic RNG.
 */
export function pickPollWinner(
  results: readonly PollResult[],
  quietBias: number = 0,
  rng: () => number = Math.random,
): PollResult | null {
  if (results.length === 0) return null;
  const adjusted = results.map((r) => ({
    r,
    adj: r.score + (quietBias > 0 ? (r.rounds_since_spoke ?? 0) * quietBias : 0),
  }));
  let best = adjusted[0]!;
  const tied: typeof adjusted = [best];
  for (let i = 1; i < adjusted.length; i++) {
    const cand = adjusted[i]!;
    if (cand.adj > best.adj) {
      best = cand;
      tied.length = 0;
      tied.push(cand);
    } else if (cand.adj === best.adj) {
      tied.push(cand);
    }
  }
  if (tied.length === 1) return tied[0]!.r;
  // Tie-break: quietest (highest rounds_since_spoke), then random.
  tied.sort(
    (a, b) => (b.r.rounds_since_spoke ?? 0) - (a.r.rounds_since_spoke ?? 0),
  );
  const topQuiet = tied[0]!.r.rounds_since_spoke ?? 0;
  const stillTied = tied.filter(
    (t) => (t.r.rounds_since_spoke ?? 0) === topQuiet,
  );
  if (stillTied.length === 1) return stillTied[0]!.r;
  const idx = Math.floor(rng() * stillTied.length);
  return stillTied[idx]!.r;
}

/**
 * Compute the seat order for the next round.
 *
 *  - `round-robin` returns eligible seats in canonical order.
 *  - `shuffled` returns eligible seats in a shuffled order.
 *  - `host-driven` returns `[hostPick]` (single-seat round). Falls
 *    back to canonical order if the host hasn't picked or picked an
 *    ineligible seat.
 *  - `poll` returns a single-seat array with the buzz winner.
 *
 * The picker never invokes the runtime SPI itself — the scheduler
 * collects poll results / host picks upstream and feeds them in.
 */
export function pickOrder(input: PickOrderInput): string[] {
  const eligible = eligibleSeats(input.seats, input.cooldowns);
  if (eligible.length === 0) return [];

  switch (input.mode) {
    case "round-robin":
      return eligible;

    case "shuffled":
      return shuffle(eligible, input.rng);

    case "host-driven": {
      const pick = input.hostPick;
      if (pick && eligible.includes(pick)) {
        return [pick];
      }
      // Fallback: if host hasn't picked or picked an ineligible seat,
      // advance with the next non-host eligible seat so the round
      // doesn't stall. This keeps host-driven mode robust.
      const nonHost = eligible.filter((s) => s !== input.hostSeatId);
      if (nonHost.length > 0) return [nonHost[0]!];
      return [eligible[0]!];
    }

    case "poll": {
      const results = (input.pollResults ?? []).filter((r) =>
        eligible.includes(r.seat_id),
      );
      const winner = pickPollWinner(
        results,
        input.quietBias ?? 0,
        input.rng,
      );
      return winner ? [winner.seat_id] : [];
    }
  }
}
