import { describe, test, expect } from "bun:test";
import { BuzzCoordinator } from "./buzz-coordinator.ts";

describe("BuzzCoordinator", () => {
  test("press resolves a pending waiter", async () => {
    const c = new BuzzCoordinator();
    const key = { session_id: "s1", seat_id: "alice", nonce: "nonce0001" };
    const pending = c.wait(key, 1000);
    const resolved = c.resolvePress(key, 7, "I have a point");
    expect(resolved).toBe(true);
    await expect(pending).resolves.toEqual({
      kind: "pressed",
      score: 7,
      intent: "I have a point",
    });
    expect(c.size()).toBe(0);
  });

  test("pass resolves a pending waiter", async () => {
    const c = new BuzzCoordinator();
    const key = { session_id: "s1", seat_id: "alice", nonce: "nonce0002" };
    const pending = c.wait(key, 1000);
    c.resolvePass(key, "nothing to add");
    await expect(pending).resolves.toEqual({
      kind: "passed",
      reason: "nothing to add",
    });
  });

  test("timeout resolves with kind=timeout", async () => {
    const c = new BuzzCoordinator();
    const key = { session_id: "s1", seat_id: "alice", nonce: "nonce0003" };
    const t0 = Date.now();
    const pending = c.wait(key, 50);
    const res = await pending;
    expect(res).toEqual({ kind: "timeout" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    expect(c.size()).toBe(0);
  });

  test("cancel removes waiter without resolving", () => {
    const c = new BuzzCoordinator();
    const key = { session_id: "s1", seat_id: "alice", nonce: "nonce0004" };
    void c.wait(key, 10000);
    expect(c.size()).toBe(1);
    c.cancel(key);
    expect(c.size()).toBe(0);
  });

  test("concurrent waiters resolve by nonce, not by seat", async () => {
    const c = new BuzzCoordinator();
    const k1 = { session_id: "s1", seat_id: "alice", nonce: "nonceAAAA" };
    const k2 = { session_id: "s1", seat_id: "alice", nonce: "nonceBBBB" };
    const p1 = c.wait(k1, 1000);
    const p2 = c.wait(k2, 1000);
    c.resolvePress(k2, 9, "from k2");
    c.resolvePass(k1, "from k1");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ kind: "passed", reason: "from k1" });
    expect(r2).toEqual({ kind: "pressed", score: 9, intent: "from k2" });
  });

  test("resolve with unknown nonce returns false", () => {
    const c = new BuzzCoordinator();
    const key = { session_id: "s1", seat_id: "alice", nonce: "ghostnonce" };
    expect(c.resolvePress(key, 1, "x")).toBe(false);
    expect(c.resolvePass(key)).toBe(false);
  });
});
