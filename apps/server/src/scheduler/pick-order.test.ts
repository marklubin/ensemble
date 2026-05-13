import { describe, expect, test } from "bun:test";
import {
  eligibleSeats,
  pickOrder,
  pickPollWinner,
  shuffle,
  type PollResult,
} from "./pick-order.ts";

/**
 * L1 unit tests for pure picker functions. Targets 100% branch
 * coverage across all four turn-taking modes + cooldown intersections.
 */

describe("eligibleSeats", () => {
  test("returns all seats when no cooldowns", () => {
    expect(eligibleSeats(["a", "b", "c"], new Map())).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  test("filters out seats with positive cooldown", () => {
    expect(
      eligibleSeats(
        ["a", "b", "c"],
        new Map([
          ["b", 2],
          ["c", 0], // 0 is eligible
        ]),
      ),
    ).toEqual(["a", "c"]);
  });
  test("returns empty when all seats on cooldown", () => {
    expect(
      eligibleSeats(
        ["a", "b"],
        new Map([
          ["a", 1],
          ["b", 1],
        ]),
      ),
    ).toEqual([]);
  });
});

describe("shuffle", () => {
  test("returns same set with deterministic rng", () => {
    const rng = () => 0; // always pick first element
    const result = shuffle(["a", "b", "c", "d"], rng);
    expect(result.sort()).toEqual(["a", "b", "c", "d"]);
  });
  test("rng=0 produces a known order (sanity)", () => {
    const rng = () => 0;
    expect(shuffle(["a", "b", "c"], rng)).toEqual(["b", "c", "a"]);
  });
  test("does not mutate input", () => {
    const input = ["a", "b", "c"];
    shuffle(input, () => 0.5);
    expect(input).toEqual(["a", "b", "c"]);
  });
  test("defaults to Math.random when rng omitted", () => {
    const out = shuffle(["x", "y", "z"]);
    expect(out.sort()).toEqual(["x", "y", "z"]);
  });
});

describe("pickPollWinner", () => {
  test("returns null on empty results", () => {
    expect(pickPollWinner([])).toBeNull();
  });

  test("picks highest-score result", () => {
    const results: PollResult[] = [
      { seat_id: "a", score: 2, intent: "" },
      { seat_id: "b", score: 9, intent: "" },
      { seat_id: "c", score: 5, intent: "" },
    ];
    expect(pickPollWinner(results)?.seat_id).toBe("b");
  });

  test("applies quiet bias to break ties", () => {
    const results: PollResult[] = [
      { seat_id: "a", score: 5, intent: "", rounds_since_spoke: 0 },
      { seat_id: "b", score: 5, intent: "", rounds_since_spoke: 3 },
    ];
    expect(pickPollWinner(results, 1)?.seat_id).toBe("b");
  });

  test("ties broken by quietness even without bias", () => {
    const results: PollResult[] = [
      { seat_id: "a", score: 5, intent: "", rounds_since_spoke: 0 },
      { seat_id: "b", score: 5, intent: "", rounds_since_spoke: 3 },
    ];
    expect(pickPollWinner(results)?.seat_id).toBe("b");
  });

  test("ties broken by rng when fully tied", () => {
    const results: PollResult[] = [
      { seat_id: "a", score: 5, intent: "", rounds_since_spoke: 1 },
      { seat_id: "b", score: 5, intent: "", rounds_since_spoke: 1 },
    ];
    // rng=0 picks first
    expect(pickPollWinner(results, 0, () => 0)?.seat_id).toBe("a");
    expect(pickPollWinner(results, 0, () => 0.999)?.seat_id).toBe("b");
  });

  test("single result returns directly", () => {
    expect(
      pickPollWinner([{ seat_id: "solo", score: 1, intent: "" }])?.seat_id,
    ).toBe("solo");
  });

  test("default rng path (no rng arg, full tie)", () => {
    // Cover the default Math.random branch in tie-break.
    const results: PollResult[] = [
      { seat_id: "a", score: 5, intent: "", rounds_since_spoke: 0 },
      { seat_id: "b", score: 5, intent: "", rounds_since_spoke: 0 },
    ];
    const winner = pickPollWinner(results);
    expect(["a", "b"]).toContain(winner!.seat_id);
  });
});

describe("pickOrder — round-robin", () => {
  test("returns all seats in canonical order", () => {
    expect(
      pickOrder({
        mode: "round-robin",
        seats: ["a", "b", "c"],
        cooldowns: new Map(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("filters out a cooled-down seat", () => {
    expect(
      pickOrder({
        mode: "round-robin",
        seats: ["a", "b", "c"],
        cooldowns: new Map([["b", 1]]),
      }),
    ).toEqual(["a", "c"]);
  });

  test("returns empty when all on cooldown", () => {
    expect(
      pickOrder({
        mode: "round-robin",
        seats: ["a", "b"],
        cooldowns: new Map([
          ["a", 1],
          ["b", 1],
        ]),
      }),
    ).toEqual([]);
  });
});

describe("pickOrder — shuffled", () => {
  test("includes every eligible seat exactly once", () => {
    const result = pickOrder({
      mode: "shuffled",
      seats: ["a", "b", "c", "d"],
      cooldowns: new Map(),
      rng: () => 0,
    });
    expect(result.length).toBe(4);
    expect(new Set(result)).toEqual(new Set(["a", "b", "c", "d"]));
  });
  test("respects cooldowns", () => {
    const result = pickOrder({
      mode: "shuffled",
      seats: ["a", "b", "c"],
      cooldowns: new Map([["c", 2]]),
      rng: () => 0,
    });
    expect(result).not.toContain("c");
    expect(result.length).toBe(2);
  });
});

describe("pickOrder — host-driven", () => {
  test("returns the host's pick when eligible", () => {
    expect(
      pickOrder({
        mode: "host-driven",
        seats: ["host", "a", "b"],
        cooldowns: new Map(),
        hostSeatId: "host",
        hostPick: "a",
      }),
    ).toEqual(["a"]);
  });

  test("falls back to first non-host eligible when host pick missing", () => {
    expect(
      pickOrder({
        mode: "host-driven",
        seats: ["host", "a", "b"],
        cooldowns: new Map(),
        hostSeatId: "host",
      }),
    ).toEqual(["a"]);
  });

  test("falls back to first non-host eligible when pick ineligible", () => {
    expect(
      pickOrder({
        mode: "host-driven",
        seats: ["host", "a", "b"],
        cooldowns: new Map([["a", 2]]),
        hostSeatId: "host",
        hostPick: "a",
      }),
    ).toEqual(["b"]);
  });

  test("falls back to the host when no other seat is eligible", () => {
    expect(
      pickOrder({
        mode: "host-driven",
        seats: ["host", "a"],
        cooldowns: new Map([["a", 2]]),
        hostSeatId: "host",
      }),
    ).toEqual(["host"]);
  });

  test("returns empty when all on cooldown", () => {
    expect(
      pickOrder({
        mode: "host-driven",
        seats: ["host", "a"],
        cooldowns: new Map([
          ["host", 1],
          ["a", 1],
        ]),
        hostSeatId: "host",
      }),
    ).toEqual([]);
  });
});

describe("pickOrder — poll", () => {
  test("returns single-seat array with buzz winner", () => {
    const pollResults: PollResult[] = [
      { seat_id: "a", score: 2, intent: "" },
      { seat_id: "b", score: 9, intent: "speak loudly" },
      { seat_id: "c", score: 2, intent: "" },
    ];
    expect(
      pickOrder({
        mode: "poll",
        seats: ["a", "b", "c"],
        cooldowns: new Map(),
        pollResults,
      }),
    ).toEqual(["b"]);
  });

  test("excludes ineligible seats from the poll pool", () => {
    const pollResults: PollResult[] = [
      { seat_id: "a", score: 8, intent: "" },
      { seat_id: "b", score: 5, intent: "" },
    ];
    expect(
      pickOrder({
        mode: "poll",
        seats: ["a", "b"],
        cooldowns: new Map([["a", 1]]),
        pollResults,
      }),
    ).toEqual(["b"]);
  });

  test("returns empty when poll has no eligible respondents", () => {
    expect(
      pickOrder({
        mode: "poll",
        seats: ["a", "b"],
        cooldowns: new Map(),
        pollResults: [],
      }),
    ).toEqual([]);
  });

  test("returns empty when all seats on cooldown (poll skipped)", () => {
    expect(
      pickOrder({
        mode: "poll",
        seats: ["a", "b"],
        cooldowns: new Map([
          ["a", 1],
          ["b", 1],
        ]),
        pollResults: [
          { seat_id: "a", score: 9, intent: "" },
        ],
      }),
    ).toEqual([]);
  });

  test("pollResults omitted means winner=null", () => {
    expect(
      pickOrder({
        mode: "poll",
        seats: ["a"],
        cooldowns: new Map(),
      }),
    ).toEqual([]);
  });
});
