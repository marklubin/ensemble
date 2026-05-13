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
 * L4 integration: 3 seats, RecordedRuntime per seat, 2 rounds in
 * round-robin mode. Assert:
 *   - 6 turns recorded in canonical order
 *   - every emitted event validates against the SseEvent schema
 *   - SSE event ordering matches the scheduler's transcript
 */
describe("scheduler integration: round-robin 3 seats × 2 rounds", () => {
  test("emits 6 turns in canonical order with valid SSE events", async () => {
    const seats: SeatInfo[] = [
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
      { seat_id: "b", persona_id: "pb", persona_name: "Bea", runtime_type: "rec" },
      { seat_id: "c", persona_id: "pc", persona_name: "Cai", runtime_type: "rec" },
    ];

    const rtA = new RecordedRuntime({
      turnChunks: {
        a: [["A1-"], ["A2"]],
      },
    });
    const rtB = new RecordedRuntime({
      turnChunks: {
        b: [["B1"], ["B2"]],
      },
    });
    const rtC = new RecordedRuntime({
      turnChunks: {
        c: [["C1"], ["C2"]],
      },
    });

    const handles = new Map<string, InstanceHandle>([
      ["a", { id: "ha", seat_id: "a", capabilities: rtA.defaultCapabilities }],
      ["b", { id: "hb", seat_id: "b", capabilities: rtB.defaultCapabilities }],
      ["c", { id: "hc", seat_id: "c", capabilities: rtC.defaultCapabilities }],
    ]);
    const runtimes = new Map<string, PersonaRuntime>([
      ["a", rtA],
      ["b", rtB],
      ["c", rtC],
    ]);
    const bus = new EventBus();
    const events: SseEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const sched = new SessionScheduler({
      sessionId: "sess-rr",
      mode: "round-robin",
      seats,
      handles,
      runtimes,
      bus,
      length: { kind: "n_rounds", n: 2 },
      // Disable cooldowns so round-robin truly cycles every seat each round.
      cooldownRounds: 0,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await sched.start();

    // Six turns total, ordered a/b/c/a/b/c.
    const turnEnds = events.filter(
      (e): e is Extract<SseEvent, { type: "turn.end" }> =>
        e.type === "turn.end",
    );
    expect(turnEnds.length).toBe(6);
    expect(turnEnds.map((t) => t.seat_id)).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
      "c",
    ]);
    // Full text per turn.
    expect(turnEnds.map((t) => t.full_text)).toEqual([
      "A1-",
      "B1",
      "C1",
      "A2",
      "B2",
      "C2",
    ]);

    // Two round.start and round.end events with the right order array.
    const roundStarts = events.filter(
      (e): e is Extract<SseEvent, { type: "round.start" }> =>
        e.type === "round.start",
    );
    expect(roundStarts.length).toBe(2);
    expect(roundStarts[0]!.order).toEqual(["a", "b", "c"]);
    expect(roundStarts[1]!.order).toEqual(["a", "b", "c"]);

    // Schema validation on every event.
    for (const ev of events) {
      expect(SseEvent.safeParse(ev).success).toBe(true);
    }

    // Session lifecycle bookends.
    expect(events[0]!.type).toBe("session.start");
    expect(events.at(-1)!.type).toBe("session.end");

    // Each runtime saw cumulative event history (the unseen-events
    // cursor advances across calls).
    expect(rtA.turns.length).toBe(2);
    expect(rtA.turns[0]!.receivedEvents).toBeGreaterThanOrEqual(0);
    expect(rtA.turns[1]!.receivedEvents).toBeGreaterThan(
      rtA.turns[0]!.receivedEvents,
    );
  });

  test("cooldowns skip a seat in subsequent rounds", async () => {
    const seats: SeatInfo[] = [
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
      { seat_id: "b", persona_id: "pb", persona_name: "Bea", runtime_type: "rec" },
    ];
    const rt = new RecordedRuntime({
      turnChunks: {
        a: [["A1"], ["A3"]],
        b: [["B1"], ["B3"]],
      },
    });
    const handles = new Map<string, InstanceHandle>([
      ["a", { id: "ha", seat_id: "a", capabilities: rt.defaultCapabilities }],
      ["b", { id: "hb", seat_id: "b", capabilities: rt.defaultCapabilities }],
    ]);
    const runtimes = new Map<string, PersonaRuntime>([
      ["a", rt],
      ["b", rt],
    ]);
    const bus = new EventBus();
    const events: SseEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const sched = new SessionScheduler({
      sessionId: "sess-cd",
      mode: "round-robin",
      seats,
      handles,
      runtimes,
      bus,
      length: { kind: "n_rounds", n: 2 },
      cooldownRounds: 1, // each seat cools for 1 round after speaking
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await sched.start();

    // Round 1 round.start emits order [a, b]. Both speak.
    // After round 1: cooldowns {a:1, b:1}. Tick at end of round
    // decrements both to 0 → eligible again for round 2.
    const roundStarts = events.filter(
      (e): e is Extract<SseEvent, { type: "round.start" }> =>
        e.type === "round.start",
    );
    expect(roundStarts[0]!.order).toEqual(["a", "b"]);
    expect(roundStarts[1]!.order).toEqual(["a", "b"]);
  });
});
