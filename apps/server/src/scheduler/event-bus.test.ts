import { describe, expect, test } from "bun:test";
import type { SseEvent } from "@ensemble/shared";
import { EventBus } from "./event-bus.ts";

const sample: SseEvent = {
  type: "session.start",
  session_id: "s1",
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("EventBus", () => {
  test("subscribe → publish delivers to subscriber", () => {
    const bus = new EventBus();
    const seen: SseEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.publish(sample);
    expect(seen).toEqual([sample]);
  });

  test("delivers to multiple subscribers", () => {
    const bus = new EventBus();
    const a: SseEvent[] = [];
    const b: SseEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish(sample);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  test("unsubscribe via returned function stops delivery", () => {
    const bus = new EventBus();
    const seen: SseEvent[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    unsub();
    bus.publish(sample);
    expect(seen).toEqual([]);
  });

  test("unsubscribe() is idempotent", () => {
    const bus = new EventBus();
    const fn = () => {};
    const unsub = bus.subscribe(fn);
    unsub();
    unsub(); // no throw
    bus.unsubscribe(fn); // no throw
    expect(bus.subscriberCount).toBe(0);
  });

  test("a throwing subscriber doesn't break others", () => {
    const bus = new EventBus();
    const seen: SseEvent[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((e) => seen.push(e));
    bus.publish(sample);
    expect(seen.length).toBe(1);
  });

  test("subscribers added during publish do not receive the in-flight event", () => {
    const bus = new EventBus();
    const seen: SseEvent[] = [];
    bus.subscribe(() => {
      bus.subscribe((e) => seen.push(e));
    });
    bus.publish(sample);
    expect(seen).toEqual([]);
  });

  test("unsubscribe inside publish doesn't break iteration of remaining", () => {
    const bus = new EventBus();
    const seen: SseEvent[] = [];
    const fn1 = () => {
      unsub1();
    };
    const unsub1 = bus.subscribe(fn1);
    bus.subscribe((e) => seen.push(e));
    bus.publish(sample);
    expect(seen.length).toBe(1);
    expect(bus.subscriberCount).toBe(1);
  });

  test("close drops subscribers and refuses new ones", () => {
    const bus = new EventBus();
    bus.subscribe(() => {});
    bus.close();
    expect(bus.subscriberCount).toBe(0);
    expect(() => bus.subscribe(() => {})).toThrow(/closed/);
    // publish after close is a no-op
    bus.publish(sample);
  });
});
