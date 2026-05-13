import { describe, expect, test } from "bun:test";
import {
  SseEvent,
  type InstanceHandle,
  type PersonaRuntime,
  type SeatInfo,
} from "@ensemble/shared";

import { EventBus, SessionScheduler } from "../../src/scheduler/index.ts";
import { RecordedRuntime } from "../../src/scheduler/test-helpers/recorded-runtime.ts";

/**
 * L4 integration: poll mode with scripted buzz scores. Each round
 * picks one winner; cooldown decrements across rounds.
 *
 * Scripted buzz scores per seat:
 *   round 1: a=2  b=9  c=2   → winner b
 *   round 2: a=2  c=8         → winner c (b on cooldown, excluded)
 *   round 3: a=9  b=4         → winner a (c on cooldown)
 */
describe("scheduler integration: poll mode 3 seats × 3 rounds", () => {
  test("highest score wins each round; cooldown excludes prior winners", async () => {
    const seats: SeatInfo[] = [
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
      { seat_id: "b", persona_id: "pb", persona_name: "Bea", runtime_type: "rec" },
      { seat_id: "c", persona_id: "pc", persona_name: "Cai", runtime_type: "rec" },
    ];
    const rt = new RecordedRuntime({
      turnChunks: {
        a: [["A-r3"]],
        b: [["B-r1"]],
        c: [["C-r2"]],
      },
      buzzResponses: {
        a: [
          { score: 2, intent: "low", can_pass: true }, // r1
          { score: 2, intent: "low", can_pass: true }, // r2
          { score: 9, intent: "ready", can_pass: true }, // r3
        ],
        b: [
          { score: 9, intent: "speak", can_pass: true }, // r1 — winner
          // b on cooldown for r2 (not polled)
          { score: 4, intent: "meh", can_pass: true }, // r3
        ],
        c: [
          { score: 2, intent: "low", can_pass: true }, // r1
          { score: 8, intent: "speak", can_pass: true }, // r2 — winner
          // c on cooldown for r3 (not polled)
        ],
      },
    });

    const handles = new Map<string, InstanceHandle>([
      ["a", { id: "ha", seat_id: "a", capabilities: rt.defaultCapabilities }],
      ["b", { id: "hb", seat_id: "b", capabilities: rt.defaultCapabilities }],
      ["c", { id: "hc", seat_id: "c", capabilities: rt.defaultCapabilities }],
    ]);
    const runtimes = new Map<string, PersonaRuntime>([
      ["a", rt],
      ["b", rt],
      ["c", rt],
    ]);
    const bus = new EventBus();
    const events: SseEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const sched = new SessionScheduler({
      sessionId: "sess-poll",
      mode: "poll",
      seats,
      handles,
      runtimes,
      bus,
      length: { kind: "n_rounds", n: 3 },
      cooldownRounds: 1, // winners sit out one round
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await sched.start();

    const turnEnds = events.filter(
      (e): e is Extract<SseEvent, { type: "turn.end" }> =>
        e.type === "turn.end",
    );
    expect(turnEnds.map((t) => t.seat_id)).toEqual(["b", "c", "a"]);
    expect(turnEnds.map((t) => t.full_text)).toEqual([
      "B-r1",
      "C-r2",
      "A-r3",
    ]);

    // Schema validation.
    for (const ev of events) {
      expect(SseEvent.safeParse(ev).success).toBe(true);
    }

    // Round.start order arrays: each round picks exactly one seat.
    const roundStarts = events.filter(
      (e): e is Extract<SseEvent, { type: "round.start" }> =>
        e.type === "round.start",
    );
    expect(roundStarts.map((r) => r.order)).toEqual([
      ["b"],
      ["c"],
      ["a"],
    ]);
  });

  test("returns empty round when no eligible respondents", async () => {
    const seats: SeatInfo[] = [
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
    ];
    const rt = new RecordedRuntime({
      buzzResponses: {
        a: [
          { score: 5, intent: "yes", can_pass: true }, // r1 — winner
        ],
      },
    });
    const handles = new Map<string, InstanceHandle>([
      ["a", { id: "ha", seat_id: "a", capabilities: rt.defaultCapabilities }],
    ]);
    const runtimes = new Map<string, PersonaRuntime>([["a", rt]]);
    const bus = new EventBus();
    const events: SseEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const sched = new SessionScheduler({
      sessionId: "sess-poll-cd",
      mode: "poll",
      seats,
      handles,
      runtimes,
      bus,
      length: { kind: "n_rounds", n: 2 },
      cooldownRounds: 5, // long cooldown so round 2 has no eligible seats
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await sched.start();

    const roundStarts = events.filter(
      (e): e is Extract<SseEvent, { type: "round.start" }> =>
        e.type === "round.start",
    );
    expect(roundStarts.length).toBe(2);
    expect(roundStarts[0]!.order).toEqual(["a"]);
    expect(roundStarts[1]!.order).toEqual([]); // poll returned no eligible seats
  });
});
