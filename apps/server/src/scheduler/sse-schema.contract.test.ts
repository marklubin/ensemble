import { describe, expect, test } from "bun:test";
import {
  SseEvent,
  type InstanceHandle,
  type PersonaRuntime,
  type SeatInfo,
} from "@ensemble/shared";

import { EventBus } from "./event-bus.ts";
import { SessionScheduler } from "./index.ts";
import { RecordedRuntime } from "./test-helpers/recorded-runtime.ts";

/**
 * L3 contract: every event emitted by the scheduler validates against
 * the canonical `SseEvent` Zod schema in @ensemble/shared. We run one
 * round through the bus and validate each emitted event.
 *
 * This is the boundary between the scheduler and any downstream
 * consumer — UI, agents-runtime, intel pipeline. If this test passes,
 * the wire shape is correct.
 */
describe("SseEvent schema contract", () => {
  test("scheduler emits only schema-valid SseEvents", async () => {
    const seats: SeatInfo[] = [
      { seat_id: "a", persona_id: "p", persona_name: "Ada", runtime_type: "recorded" },
      { seat_id: "b", persona_id: "p", persona_name: "Bea", runtime_type: "recorded" },
    ];
    const runtime = new RecordedRuntime({
      turnChunks: {
        a: [["hello ", "world"]],
        b: [["yo"]],
      },
    });

    const handles = new Map<string, InstanceHandle>([
      ["a", { id: "ha", seat_id: "a", capabilities: runtime.defaultCapabilities }],
      ["b", { id: "hb", seat_id: "b", capabilities: runtime.defaultCapabilities }],
    ]);
    const runtimes = new Map<string, PersonaRuntime>([
      ["a", runtime],
      ["b", runtime],
    ]);
    const bus = new EventBus();
    const collected: unknown[] = [];
    bus.subscribe((e) => collected.push(e));

    const sched = new SessionScheduler({
      sessionId: "sess-1",
      mode: "round-robin",
      seats,
      handles,
      runtimes,
      bus,
      length: { kind: "n_rounds", n: 1 },
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await sched.start();

    expect(collected.length).toBeGreaterThan(0);
    for (const ev of collected) {
      const result = SseEvent.safeParse(ev);
      if (!result.success) {
        // Surface the bad event for diagnostics.
        // eslint-disable-next-line no-console
        console.error("invalid SseEvent:", JSON.stringify(ev), result.error);
      }
      expect(result.success).toBe(true);
    }

    // Sanity: we saw the full lifecycle.
    const types = collected.map((e) => (e as { type: string }).type);
    expect(types).toContain("session.start");
    expect(types).toContain("round.start");
    expect(types).toContain("turn.start");
    expect(types).toContain("turn.delta");
    expect(types).toContain("turn.end");
    expect(types).toContain("round.end");
    expect(types).toContain("session.end");
  });
});
