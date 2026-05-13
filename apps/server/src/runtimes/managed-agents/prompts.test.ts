import { describe, test, expect } from "bun:test";
import {
  formatEventsAsTurnPrompt,
  formatBuzzCheckPrompt,
} from "./prompts.ts";
import type { TurnEvent } from "@ensemble/shared";

const TS = "2026-05-12T10:00:00.000Z";

describe("formatEventsAsTurnPrompt", () => {
  test("renders a single turn as **speaker**: content + your-turn tail", () => {
    const events: TurnEvent[] = [
      {
        kind: "turn",
        seat_id: "seat_a",
        speaker: "Ada",
        content: "Hello world.",
        round: 1,
        timestamp: TS,
      },
    ];
    const out = formatEventsAsTurnPrompt(events);
    expect(out).toContain("**Ada**: Hello world.");
    expect(out).toContain("It is now your turn");
  });

  test("renders multiple turn kinds in order", () => {
    const events: TurnEvent[] = [
      {
        kind: "scenario_change",
        new_prompt: "Defend free will.",
        round: 0,
        timestamp: TS,
      },
      {
        kind: "turn",
        seat_id: "s1",
        speaker: "Ada",
        content: "First.",
        round: 1,
        timestamp: TS,
      },
      {
        kind: "moderator",
        content: "Keep it civil.",
        round: 1,
        timestamp: TS,
      },
      {
        kind: "cooldown",
        seat_id: "s2",
        rounds: 2,
        reason: "interrupting",
        timestamp: TS,
      },
    ];
    const out = formatEventsAsTurnPrompt(events);
    const lines = out.split("\n");
    const idxScenario = lines.findIndex((l) => l.includes("Scenario update"));
    const idxAda = lines.findIndex((l) => l.includes("**Ada**"));
    const idxMod = lines.findIndex((l) => l.includes("[Moderator]"));
    const idxCool = lines.findIndex((l) => l.includes("[Cooldown]"));
    expect(idxScenario).toBeGreaterThanOrEqual(0);
    expect(idxAda).toBeGreaterThan(idxScenario);
    expect(idxMod).toBeGreaterThan(idxAda);
    expect(idxCool).toBeGreaterThan(idxMod);
  });

  test("empty events still produces the your-turn tail", () => {
    const out = formatEventsAsTurnPrompt([]);
    expect(out).toContain("It is now your turn");
  });

  test("moderator tool_calls are included as a summary", () => {
    const events: TurnEvent[] = [
      {
        kind: "moderator",
        content: "Forcing speaker.",
        round: 2,
        tool_calls: [
          {
            tool: "moderator.force_speaker",
            args: { seat_id: "s3" },
            result: { ok: true },
          },
        ],
        timestamp: TS,
      },
    ];
    const out = formatEventsAsTurnPrompt(events);
    expect(out).toContain("moderator.force_speaker");
    expect(out).toContain("seat_id");
  });
});

describe("formatBuzzCheckPrompt", () => {
  test("includes the nonce twice and policy guidance", () => {
    const events: TurnEvent[] = [
      {
        kind: "turn",
        seat_id: "s1",
        speaker: "Ada",
        content: "Capital is hoarded labor.",
        round: 3,
        timestamp: TS,
      },
    ];
    const out = formatBuzzCheckPrompt(events, "NONCE12345", "Speak only if you disagree.");
    expect(out).toContain("NONCE12345");
    // appears in both buzzer.press and buzzer.pass example calls
    const occurrences = out.split("NONCE12345").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(out).toContain("Speak only if you disagree.");
    expect(out).toContain("buzzer.press");
    expect(out).toContain("buzzer.pass");
  });

  test("falls back to a default policy line when none provided", () => {
    const out = formatBuzzCheckPrompt([], "ABCDEFGH");
    expect(out).toContain("buzz-in policy");
    expect(out).toContain("ABCDEFGH");
  });

  test("handles empty recent turns", () => {
    const out = formatBuzzCheckPrompt([], "NONCEXYZ1");
    expect(out).toContain("(no turns yet)");
  });
});
