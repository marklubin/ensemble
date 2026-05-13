import type { TurnEvent } from "@ensemble/shared";

/**
 * Turn a list of TurnEvent (events the runtime hasn't seen yet) into a
 * single user message for the persona's agent loop.
 *
 * Conventions:
 *   - `turn`            → "**<speaker>**: <content>"
 *   - `moderator`       → "**[Moderator]** <content>" (+ tool call summary)
 *   - `scenario_change` → "**[Scenario update]** <new prompt>"
 *   - `cooldown`        → "**[Cooldown]** <seat_id> for N rounds (<reason>)"
 *
 * Trailing instruction guarantees the agent knows it's their turn.
 */
export function formatEventsAsTurnPrompt(events: TurnEvent[]): string {
  if (events.length === 0) {
    return "It is now your turn to respond. Respond naturally in first person.";
  }

  const lines: string[] = [];
  for (const ev of events) {
    switch (ev.kind) {
      case "turn":
        lines.push(`**${ev.speaker}**: ${ev.content}`);
        break;
      case "moderator": {
        let line = `**[Moderator]** ${ev.content}`;
        if (ev.tool_calls && ev.tool_calls.length > 0) {
          const calls = ev.tool_calls
            .map((c) => `${c.tool}(${safeJson(c.args)}) → ${safeJson(c.result)}`)
            .join("; ");
          line += `  _(tool calls: ${calls})_`;
        }
        lines.push(line);
        break;
      }
      case "scenario_change":
        lines.push(`**[Scenario update]** ${ev.new_prompt}`);
        break;
      case "cooldown":
        lines.push(
          `**[Cooldown]** ${ev.seat_id} for ${ev.rounds} round(s) (${ev.reason})`,
        );
        break;
    }
  }
  lines.push("");
  lines.push("It is now your turn to respond. Respond naturally in first person.");
  return lines.join("\n");
}

/**
 * Buzz-check prompt. The agent is expected to call `buzzer.press` (with a
 * score 0-10 and one-sentence intent) or `buzzer.pass`, in both cases
 * echoing the nonce so the BuzzCoordinator can route the resolution.
 */
export function formatBuzzCheckPrompt(
  recentTurns: TurnEvent[],
  nonce: string,
  buzzInPolicy?: string,
): string {
  const recent = recentTurns.length > 0
    ? formatEventsAsTurnPromptBody(recentTurns)
    : "(no turns yet)";

  const policyLine = buzzInPolicy
    ? `Your buzz-in policy: ${buzzInPolicy}`
    : "Your buzz-in policy: respond when you have a strong opinion or domain expertise that adds value.";

  return [
    "**Buzz check.**",
    "",
    "Recent turns:",
    recent,
    "",
    `Score 0-10 how strongly you want to respond next. ${policyLine}`,
    "",
    `Call \`buzzer.press({ intensity, intent, nonce: "${nonce}" })\` if you want to speak,`,
    `or \`buzzer.pass({ reason, nonce: "${nonce}" })\` to skip this round.`,
    "",
    `You MUST include nonce="${nonce}" in the tool args verbatim.`,
  ].join("\n");
}

function formatEventsAsTurnPromptBody(events: TurnEvent[]): string {
  // Same as formatEventsAsTurnPrompt minus the trailing "your turn" line.
  if (events.length === 0) return "(no turns yet)";
  const lines: string[] = [];
  for (const ev of events) {
    switch (ev.kind) {
      case "turn":
        lines.push(`**${ev.speaker}**: ${ev.content}`);
        break;
      case "moderator":
        lines.push(`**[Moderator]** ${ev.content}`);
        break;
      case "scenario_change":
        lines.push(`**[Scenario update]** ${ev.new_prompt}`);
        break;
      case "cooldown":
        lines.push(`**[Cooldown]** ${ev.seat_id} for ${ev.rounds} round(s)`);
        break;
    }
  }
  return lines.join("\n");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
