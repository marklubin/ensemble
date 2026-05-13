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
 * L4 integration: host-driven mode. The host picker is a function the
 * scheduler calls each round; its return value is who speaks next.
 */
describe("scheduler integration: host-driven 3 rounds", () => {
  test("host picks each round; picks are honored", async () => {
    const seats: SeatInfo[] = [
      { seat_id: "host", persona_id: "ph", persona_name: "Host", role: "Host", runtime_type: "rec" },
      { seat_id: "a", persona_id: "pa", persona_name: "Ada", runtime_type: "rec" },
      { seat_id: "b", persona_id: "pb", persona_name: "Bea", runtime_type: "rec" },
    ];

    const rt = new RecordedRuntime({
      turnChunks: {
        a: [["A1"], ["A2"]],
        b: [["B1"]],
      },
    });
    const handles = new Map<string, InstanceHandle>([
      ["host", { id: "hh", seat_id: "host", capabilities: rt.defaultCapabilities }],
      ["a", { id: "ha", seat_id: "a", capabilities: rt.defaultCapabilities }],
      ["b", { id: "hb", seat_id: "b", capabilities: rt.defaultCapabilities }],
    ]);
    const runtimes = new Map<string, PersonaRuntime>([
      ["host", rt],
      ["a", rt],
      ["b", rt],
    ]);
    const bus = new EventBus();
    const events: SseEvent[] = [];
    bus.subscribe((e) => events.push(e));

    let pickIdx = 0;
    const picks = ["a", "b", "a"];

    const sched = new SessionScheduler({
      sessionId: "sess-host",
      mode: "host-driven",
      seats,
      handles,
      runtimes,
      bus,
      length: { kind: "n_rounds", n: 3 },
      cooldownRounds: 0,
      hostSeatId: "host",
      hostPicker: async (_eligible) => picks[pickIdx++] ?? null,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await sched.start();

    const turnEnds = events.filter(
      (e): e is Extract<SseEvent, { type: "turn.end" }> =>
        e.type === "turn.end",
    );
    expect(turnEnds.map((t) => t.seat_id)).toEqual(["a", "b", "a"]);
  });
});
