import type { SseEvent } from "@ensemble/shared";
import type { SessionMeta } from "../screens/session/index.tsx";

const ts = (n: number) => new Date(Date.UTC(2026, 4, 12, 13, 48, n)).toISOString();

export const SAMPLE_SESSION_META: SessionMeta = {
  session_id: "sample",
  template: "Debate",
  scenario: "Has the AI agent hype cycle peaked?",
  scenario_format: "question",
  rounds_planned: 4,
  cast: [
    {
      seat_id: "seat-alex",
      persona_id: "alex-chen",
      persona_name: "Alex Chen",
      role: "Tech-optimist",
      runtime_type: "managed-agents",
    },
    {
      seat_id: "seat-jordan",
      persona_id: "jordan-rivera",
      persona_name: "Jordan Rivera",
      role: "Skeptic",
      runtime_type: "managed-agents",
    },
    {
      seat_id: "seat-sarah",
      persona_id: "sarah-chen",
      persona_name: "Dr. Sarah Chen",
      role: "Researcher",
      runtime_type: "managed-agents",
    },
    {
      seat_id: "seat-mod",
      persona_id: "moderator",
      persona_name: "Moderator",
      role: "Moderator",
      runtime_type: "managed-agents",
    },
  ],
  human_seat_id: null,
  turn_taking: "round-robin",
  started_at: ts(0),
  cost_so_far_usd: 0.34,
};

export const SAMPLE_SESSION_EVENTS: SseEvent[] = [
  { type: "session.start", session_id: "sample", timestamp: ts(0) },
  {
    type: "round.start",
    session_id: "sample",
    round: 3,
    order: ["seat-alex", "seat-jordan", "seat-sarah", "seat-mod"],
    timestamp: ts(1),
  },
  {
    type: "turn.start",
    session_id: "sample",
    seat_id: "seat-alex",
    speaker: "Alex Chen",
    round: 3,
    turn_id: "t-alex-3",
    timestamp: ts(2),
  },
  {
    type: "turn.delta",
    session_id: "sample",
    turn_id: "t-alex-3",
    text: "Look, the definitional argument is a distraction. ",
  },
  {
    type: "turn.delta",
    session_id: "sample",
    turn_id: "t-alex-3",
    text: "Capital follows working systems.",
  },
  {
    type: "turn.end",
    session_id: "sample",
    seat_id: "seat-alex",
    turn_id: "t-alex-3",
    full_text:
      "Look, the definitional argument is a distraction. Capital follows working systems.",
    timestamp: ts(3),
  },
  {
    type: "turn.start",
    session_id: "sample",
    seat_id: "seat-jordan",
    speaker: "Jordan Rivera",
    round: 3,
    turn_id: "t-jordan-3",
    timestamp: ts(4),
  },
  {
    type: "turn.delta",
    session_id: "sample",
    turn_id: "t-jordan-3",
    text: "Alex, \"the market is sorting itself\" is the most reliable bubble-era sentence in venture history.",
  },
];
