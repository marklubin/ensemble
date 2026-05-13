/**
 * Pure reducer mapping `SseEvent` to the session view-model used by the
 * session screen. Kept side-effect-free so it can be unit-tested with a
 * deterministic feed.
 */
import type { SseEvent } from "@ensemble/shared";

export type TurnStatus = "streaming" | "complete";

export interface TurnVM {
  turn_id: string;
  seat_id: string;
  speaker: string;
  round: number;
  text: string;
  status: TurnStatus;
  timestamp: string;
}

export interface ModeratorBlockVM {
  id: string;
  round: number;
  content: string;
  timestamp: string;
  tools: { tool: string; status: string; detail?: string }[];
}

export type TranscriptEntry =
  | { kind: "round_header"; round: number; order: string[] }
  | { kind: "turn"; turn: TurnVM }
  | { kind: "moderator"; block: ModeratorBlockVM }
  | { kind: "notice"; text: string; tone: "cooldown" | "bypass" | "end" };

export interface SessionState {
  session_id: string | null;
  started_at: string | null;
  ended: boolean;
  ended_by: "user" | "n-rounds-reached" | "moderator" | null;
  current_round: number | null;
  current_order: string[];
  /** seat_id of currently speaking seat, or null. */
  current_speaker_seat: string | null;
  /** seat_ids of seats whose turn already completed in the current round. */
  completed_in_round: string[];
  /** Seats subject to cooldown: seat_id → rounds remaining. */
  cooldowns: Record<string, number>;
  /** Seats marked bypassed in the current round. */
  bypassed: string[];
  entries: TranscriptEntry[];
  /** Index from turn_id → entries position; used to append deltas O(1). */
  turn_index: Record<string, number>;
  /** Latest pending tool.status events per (seat_id, tool). */
  pending_tools: Record<string, { tool: string; status: string; detail?: string }>;
  /** Total turn count (delivered + streaming). */
  turn_count: number;
}

export const initialSessionState: SessionState = {
  session_id: null,
  started_at: null,
  ended: false,
  ended_by: null,
  current_round: null,
  current_order: [],
  current_speaker_seat: null,
  completed_in_round: [],
  cooldowns: {},
  bypassed: [],
  entries: [],
  turn_index: {},
  pending_tools: {},
  turn_count: 0,
};

export function sessionReducer(
  state: SessionState,
  event: SseEvent,
): SessionState {
  switch (event.type) {
    case "session.start":
      return {
        ...initialSessionState,
        session_id: event.session_id,
        started_at: event.timestamp,
      };

    case "session.end":
      return {
        ...state,
        ended: true,
        ended_by: event.ended_by,
        current_speaker_seat: null,
        entries: [
          ...state.entries,
          {
            kind: "notice",
            text: `Session ended (${event.ended_by})`,
            tone: "end",
          },
        ],
      };

    case "round.start": {
      const header: TranscriptEntry = {
        kind: "round_header",
        round: event.round,
        order: event.order,
      };
      return {
        ...state,
        current_round: event.round,
        current_order: event.order,
        completed_in_round: [],
        bypassed: [],
        entries: [...state.entries, header],
      };
    }

    case "round.end":
      return {
        ...state,
        current_speaker_seat: null,
      };

    case "turn.start": {
      const turn: TurnVM = {
        turn_id: event.turn_id,
        seat_id: event.seat_id,
        speaker: event.speaker,
        round: event.round,
        text: "",
        status: "streaming",
        timestamp: event.timestamp,
      };
      const entries: TranscriptEntry[] = [...state.entries, { kind: "turn", turn }];
      return {
        ...state,
        current_speaker_seat: event.seat_id,
        entries,
        turn_index: { ...state.turn_index, [event.turn_id]: entries.length - 1 },
        turn_count: state.turn_count + 1,
      };
    }

    case "turn.delta": {
      const idx = state.turn_index[event.turn_id];
      if (idx === undefined) return state;
      const existing = state.entries[idx];
      if (!existing || existing.kind !== "turn") return state;
      const updated: TranscriptEntry = {
        kind: "turn",
        turn: { ...existing.turn, text: existing.turn.text + event.text },
      };
      const entries = state.entries.slice();
      entries[idx] = updated;
      return { ...state, entries };
    }

    case "turn.end": {
      const idx = state.turn_index[event.turn_id];
      if (idx === undefined) return state;
      const existing = state.entries[idx];
      if (!existing || existing.kind !== "turn") return state;
      const updated: TranscriptEntry = {
        kind: "turn",
        turn: {
          ...existing.turn,
          text: event.full_text || existing.turn.text,
          status: "complete",
        },
      };
      const entries = state.entries.slice();
      entries[idx] = updated;
      const completed = state.completed_in_round.includes(event.seat_id)
        ? state.completed_in_round
        : [...state.completed_in_round, event.seat_id];
      return {
        ...state,
        entries,
        completed_in_round: completed,
        current_speaker_seat:
          state.current_speaker_seat === event.seat_id ? null : state.current_speaker_seat,
      };
    }

    case "moderator.message": {
      const block: ModeratorBlockVM = {
        id: `mod-${state.entries.length}`,
        round: event.round,
        content: event.content,
        timestamp: event.timestamp,
        tools: Object.values(state.pending_tools),
      };
      return {
        ...state,
        entries: [...state.entries, { kind: "moderator", block }],
        pending_tools: {},
      };
    }

    case "tool.status": {
      const key = `${event.seat_id}::${event.tool}`;
      if (event.status === "complete" || event.status === "error") {
        // Keep complete entries so the next moderator block can render the
        // summary chip; drop them after the moderator message consumes them.
        return {
          ...state,
          pending_tools: {
            ...state.pending_tools,
            [key]: { tool: event.tool, status: event.status, detail: event.detail },
          },
        };
      }
      return {
        ...state,
        pending_tools: {
          ...state.pending_tools,
          [key]: { tool: event.tool, status: event.status, detail: event.detail },
        },
      };
    }

    case "cooldown.applied":
      return {
        ...state,
        cooldowns: { ...state.cooldowns, [event.seat_id]: event.rounds },
        entries: [
          ...state.entries,
          {
            kind: "notice",
            text: `${event.seat_id} cooled down for ${event.rounds} round(s): ${event.reason}`,
            tone: "cooldown",
          },
        ],
      };

    case "seat.bypassed":
      return {
        ...state,
        bypassed: state.bypassed.includes(event.seat_id)
          ? state.bypassed
          : [...state.bypassed, event.seat_id],
        entries: [
          ...state.entries,
          {
            kind: "notice",
            text: `${event.seat_id} bypassed this round: ${event.reason}`,
            tone: "bypass",
          },
        ],
      };

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/** Helper: derive queue chip state from session VM. */
export function queueChips(state: SessionState): Array<{
  seat_id: string;
  state: "done" | "current" | "upcoming" | "bypassed";
}> {
  return state.current_order.map((seat_id) => {
    if (state.bypassed.includes(seat_id)) return { seat_id, state: "bypassed" as const };
    if (seat_id === state.current_speaker_seat) return { seat_id, state: "current" as const };
    if (state.completed_in_round.includes(seat_id)) return { seat_id, state: "done" as const };
    return { seat_id, state: "upcoming" as const };
  });
}
