import { describe, expect, test } from "bun:test";
import { MockHostApi } from "./mock-host-api.ts";

describe("MockHostApi", () => {
  test("memory.write then memory.read returns the value", async () => {
    const api = new MockHostApi();
    await api.call("seat-1", "memory.write", { key: "k", value: "v" });
    const r = await api.call("seat-1", "memory.read", { key: "k" });
    expect(r).toEqual({ value: "v" });
  });

  test("memory.list reflects every write", async () => {
    const api = new MockHostApi();
    await api.call("seat-1", "memory.write", { key: "a", value: 1 });
    await api.call("seat-1", "memory.write", { key: "b", value: 2 });
    const r = (await api.call("seat-1", "memory.list", {})) as {
      keys: string[];
    };
    expect(r.keys.sort()).toEqual(["a", "b"]);
  });

  test("memory is per-seat", async () => {
    const api = new MockHostApi();
    await api.call("seat-1", "memory.write", { key: "k", value: 1 });
    const r = await api.call("seat-2", "memory.read", { key: "k" });
    expect(r).toEqual({ value: null });
  });

  test("buzzer.press records the call", async () => {
    const api = new MockHostApi();
    await api.call("seat-1", "buzzer.press", {
      intensity: 7,
      intent: "speak",
    });
    expect(api.buzzes).toHaveLength(1);
    expect(api.buzzes[0]?.intensity).toBe(7);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.tool).toBe("buzzer.press");
  });

  test("buzzer.pass records the call", async () => {
    const api = new MockHostApi();
    await api.call("seat-1", "buzzer.pass", { reason: "no view" });
    expect(api.passes).toHaveLength(1);
    expect(api.passes[0]?.reason).toBe("no view");
  });

  test("cast.list returns configured cast", async () => {
    const cast = [
      {
        seat_id: "a",
        persona_id: "p",
        persona_name: "Ada",
        runtime_type: "r",
      },
    ];
    const api = new MockHostApi({ cast });
    const r = (await api.call("a", "cast.list", {})) as {
      cast: typeof cast;
    };
    expect(r.cast).toEqual(cast);
  });

  test("round.info reports round, mode, and seat cooldown", async () => {
    const api = new MockHostApi({
      round: { round: 3, mode: "shuffled" },
      cooldowns: new Map([["a", 2]]),
    });
    const r = await api.call("a", "round.info", {});
    expect(r).toEqual({ round: 3, mode: "shuffled", your_cooldown: 2 });
  });

  test("moderator tools record their calls", async () => {
    const api = new MockHostApi();
    await api.call("mod", "moderator.force_speaker", { seat_id: "x" });
    await api.call("mod", "moderator.cooldown", {
      seat_id: "y",
      rounds: 2,
      reason: "off-topic",
    });
    await api.call("mod", "moderator.bypass", {
      seat_id: "z",
      reason: "tech issue",
    });
    await api.call("mod", "moderator.inject", {});
    expect(api.forceSpeakerCalls).toHaveLength(1);
    expect(api.cooldownCalls).toHaveLength(1);
    expect(api.bypassCalls).toHaveLength(1);
    expect(api.injectCalls).toHaveLength(1);
  });

  test("callsForSeat / callsForTool filters work", async () => {
    const api = new MockHostApi();
    await api.call("a", "memory.write", { key: "k", value: 1 });
    await api.call("b", "memory.write", { key: "k", value: 2 });
    expect(api.callsForSeat("a")).toHaveLength(1);
    expect(api.callsForTool("memory.write")).toHaveLength(2);
  });
});
