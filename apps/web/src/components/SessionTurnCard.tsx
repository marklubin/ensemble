import type { TurnVM } from "../screens/session/reducer.ts";

/**
 * One screenplay-style turn block. Speaker in the left margin in caps,
 * dialogue flush-left in the right column. The blinking cursor renders
 * only while the turn is still streaming.
 */
export interface SessionTurnCardProps {
  turn: TurnVM;
  /** Index into the cast list — used to pick a speaker color (p1..p4). */
  colorIndex: number;
  /** When true, render the human speaker color rather than persona color. */
  isHuman?: boolean;
  /** Optional role text rendered below the speaker name. */
  role?: string;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return `[${d.toTimeString().slice(0, 5)}]`;
  } catch {
    return "";
  }
}

export function SessionTurnCard({ turn, colorIndex, isHuman, role }: SessionTurnCardProps) {
  const colorClass = isHuman ? "human" : `p${(colorIndex % 4) + 1}`;
  const isStreaming = turn.status === "streaming";

  // Split text by double-newline into paragraphs so the screenplay block
  // stays readable. Empty text → single empty paragraph (cursor only).
  const paragraphs = turn.text.length > 0 ? turn.text.split(/\n{2,}/) : [""];

  return (
    <div className="session-turn" data-testid="session-turn" data-turn-id={turn.turn_id}>
      <div className={`session-speaker ${colorClass}`}>
        {turn.speaker}
        {role && (
          <span className="session-speaker-meta">
            {role}
            {isStreaming ? " · speaking" : ""}
          </span>
        )}
      </div>
      <div className={`session-lines${isStreaming ? " streaming" : ""}`} data-testid="session-turn-lines">
        <span className="session-line-num">{formatTimestamp(turn.timestamp)}</span>
        {paragraphs.map((p, i) => {
          const isLast = i === paragraphs.length - 1;
          return (
            <p key={i}>
              {p}
              {isLast && isStreaming && <span className="session-cursor" aria-hidden="true" />}
            </p>
          );
        })}
      </div>
    </div>
  );
}
