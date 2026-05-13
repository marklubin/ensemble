import { describe, expect, test } from "bun:test";
import type { SseEvent } from "@ensemble/shared";
import { initialSessionState, queueChips, sessionReducer } from "./reducer.ts";

const T = (n: number) => new Date(Date.UTC(2026, 4, 12, 10, 0, n)).toISOString();

describe("sessionReducer", () => {
  test("session.start resets state", () => {
    const s = sessionReducer(initialSessionState, {
      type: "session.start",
      session_id: "s1",
      timestamp: T(0),
    });
    expect(s.session_id).toBe("s1");
    expect(s.entries).toHaveLength(0);
    expect(s.ended).toBe(false);
  });

  test("round.start records order and appends header", () => {
    let s = initialSessionState;
    s = sessionReducer(s, { type: "session.start", session_id: "s1", timestamp: T(0) });
    s = sessionReducer(s, {
      type: "round.start",
      session_id: "s1",
      round: 1,
      order: ["a", "b", "c"],
      timestamp: T(1),
    });
    expect(s.current_round).toBe(1);
    expect(s.current_order).toEqual(["a", "b", "c"]);
    expect(s.entries[0]?.kind).toBe("round_header");
  });

  test("turn.start + deltas accumulate text", () => {
    let s = initialSessionState;
    s = sessionReducer(s, { type: "session.start", session_id: "s1", timestamp: T(0) });
    s = sessionReducer(s, {
      type: "round.start",
      session_id: "s1",
      round: 1,
      order: ["a"],
      timestamp: T(1),
    });
    s = sessionReducer(s, {
      type: "turn.start",
      session_id: "s1",
      seat_id: "a",
      speaker: "Alice",
      round: 1,
      turn_id: "t1",
      timestamp: T(2),
    });
    s = sessionReducer(s, { type: "turn.delta", session_id: "s1", turn_id: "t1", text: "Hello " });
    s = sessionReducer(s, { type: "turn.delta", session_id: "s1", turn_id: "t1", text: "world" });
    const turnEntry = s.entries.find((e) => e.kind === "turn");
    if (!turnEntry || turnEntry.kind !== "turn") throw new Error("turn entry missing");
    expect(turnEntry.turn.text).toBe("Hello world");
    expect(turnEntry.turn.status).toBe("streaming");
    expect(s.current_speaker_seat).toBe("a");
  });

  test("turn.end finalizes status and clears speaker", () => {
    let s = initialSessionState;
    const events: SseEvent[] = [
      { type: "session.start", session_id: "s1", timestamp: T(0) },
      { type: "round.start", session_id: "s1", round: 1, order: ["a"], timestamp: T(1) },
      {
        type: "turn.start",
        session_id: "s1",
        seat_id: "a",
        speaker: "Alice",
        round: 1,
        turn_id: "t1",
        timestamp: T(2),
      },
      { type: "turn.delta", session_id: "s1", turn_id: "t1", text: "Hi" },
      {
        type: "turn.end",
        session_id: "s1",
        seat_id: "a",
        turn_id: "t1",
        full_text: "Hi there.",
        timestamp: T(3),
      },
    ];
    for (const e of events) s = sessionReducer(s, e);
    const turnEntry = s.entries.find((e) => e.kind === "turn");
    if (!turnEntry || turnEntry.kind !== "turn") throw new Error("turn entry missing");
    expect(turnEntry.turn.status).toBe("complete");
    expect(turnEntry.turn.text).toBe("Hi there.");
    expect(s.current_speaker_seat).toBeNull();
    expect(s.completed_in_round).toContain("a");
  });

  test("moderator.message attaches pending tool chips and clears them", () => {
    let s = initialSessionState;
    s = sessionReducer(s, { type: "session.start", session_id: "s1", timestamp: T(0) });
    s = sessionReducer(s, {
      type: "round.start",
      session_id: "s1",
      round: 1,
      order: ["a"],
      timestamp: T(1),
    });
    s = sessionReducer(s, {
      type: "tool.status",
      session_id: "s1",
      seat_id: "mod",
      tool: "web.search",
      status: "complete",
      detail: "2 sources",
      timestamp: T(2),
    });
    s = sessionReducer(s, {
      type: "moderator.message",
      session_id: "s1",
      round: 1,
      content: "Fact-checked.",
      timestamp: T(3),
    });
    const modEntry = s.entries.find((e) => e.kind === "moderator");
    if (!modEntry || modEntry.kind !== "moderator") throw new Error("moderator entry missing");
    expect(modEntry.block.tools).toHaveLength(1);
    expect(modEntry.block.tools[0]?.tool).toBe("web.search");
    expect(s.pending_tools).toEqual({});
  });

  test("queueChips reflects current/done/upcoming/bypassed states", () => {
    let s = initialSessionState;
    s = sessionReducer(s, { type: "session.start", session_id: "s1", timestamp: T(0) });
    s = sessionReducer(s, {
      type: "round.start",
      session_id: "s1",
      round: 1,
      order: ["a", "b", "c"],
      timestamp: T(1),
    });
    s = sessionReducer(s, {
      type: "turn.start",
      session_id: "s1",
      seat_id: "a",
      speaker: "A",
      round: 1,
      turn_id: "t-a",
      timestamp: T(2),
    });
    s = sessionReducer(s, {
      type: "turn.end",
      session_id: "s1",
      seat_id: "a",
      turn_id: "t-a",
      full_text: "...",
      timestamp: T(3),
    });
    s = sessionReducer(s, {
      type: "turn.start",
      session_id: "s1",
      seat_id: "b",
      speaker: "B",
      round: 1,
      turn_id: "t-b",
      timestamp: T(4),
    });
    s = sessionReducer(s, {
      type: "seat.bypassed",
      session_id: "s1",
      seat_id: "c",
      round: 1,
      reason: "cooldown",
      timestamp: T(5),
    });
    const chips = queueChips(s);
    expect(chips).toEqual([
      { seat_id: "a", state: "done" },
      { seat_id: "b", state: "current" },
      { seat_id: "c", state: "bypassed" },
    ]);
  });

  test("cooldown.applied records remaining rounds and adds notice", () => {
    let s = initialSessionState;
    s = sessionReducer(s, { type: "session.start", session_id: "s1", timestamp: T(0) });
    s = sessionReducer(s, {
      type: "cooldown.applied",
      session_id: "s1",
      seat_id: "a",
      rounds: 2,
      reason: "ranting",
      timestamp: T(1),
    });
    expect(s.cooldowns).toEqual({ a: 2 });
    expect(s.entries.at(-1)?.kind).toBe("notice");
  });

  test("session.end marks ended and adds end notice", () => {
    let s = initialSessionState;
    s = sessionReducer(s, { type: "session.start", session_id: "s1", timestamp: T(0) });
    s = sessionReducer(s, {
      type: "session.end",
      session_id: "s1",
      ended_by: "n-rounds-reached",
      timestamp: T(1),
    });
    expect(s.ended).toBe(true);
    expect(s.ended_by).toBe("n-rounds-reached");
    expect(s.entries.at(-1)?.kind).toBe("notice");
  });
});
