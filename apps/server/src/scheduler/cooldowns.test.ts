import { describe, expect, test } from "bun:test";
import { CooldownTracker } from "./cooldowns.ts";

describe("CooldownTracker", () => {
  test("default state: every seat is eligible, get returns 0", () => {
    const c = new CooldownTracker();
    expect(c.isEligible("a")).toBe(true);
    expect(c.get("a")).toBe(0);
  });

  test("apply puts a seat on cooldown for N rounds", () => {
    const c = new CooldownTracker();
    c.apply("a", 2);
    expect(c.isEligible("a")).toBe(false);
    expect(c.get("a")).toBe(2);
  });

  test("apply with 0 rounds is a no-op", () => {
    const c = new CooldownTracker();
    c.apply("a", 0);
    expect(c.isEligible("a")).toBe(true);
  });

  test("apply with negative rounds is a no-op", () => {
    const c = new CooldownTracker();
    c.apply("a", -1);
    expect(c.isEligible("a")).toBe(true);
  });

  test("apply takes the larger of current/new (longer wins)", () => {
    const c = new CooldownTracker();
    c.apply("a", 1);
    c.apply("a", 3);
    expect(c.get("a")).toBe(3);
    c.apply("a", 2); // shorter — ignored
    expect(c.get("a")).toBe(3);
  });

  test("tick decrements every active cooldown by 1", () => {
    const c = new CooldownTracker();
    c.apply("a", 2);
    c.apply("b", 1);
    const cleared = c.tick();
    expect(cleared).toEqual(["b"]);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(0);
    expect(c.isEligible("b")).toBe(true);
  });

  test("tick clears seats reaching 0", () => {
    const c = new CooldownTracker();
    c.apply("a", 1);
    c.tick();
    expect(c.isEligible("a")).toBe(true);
  });

  test("snapshot is a copy, not a live reference", () => {
    const c = new CooldownTracker();
    c.apply("a", 2);
    const snap = c.snapshot();
    c.tick();
    expect(snap.get("a")).toBe(2);
    expect(c.get("a")).toBe(1);
  });

  test("clear wipes all cooldowns", () => {
    const c = new CooldownTracker();
    c.apply("a", 3);
    c.apply("b", 4);
    c.clear();
    expect(c.isEligible("a")).toBe(true);
    expect(c.isEligible("b")).toBe(true);
  });

  test("bypass applies a 1-round cooldown", () => {
    const c = new CooldownTracker();
    c.bypass("a");
    expect(c.get("a")).toBe(1);
    c.tick();
    expect(c.isEligible("a")).toBe(true);
  });
});
