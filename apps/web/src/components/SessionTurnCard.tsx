import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import type { TurnVM } from "../screens/session/reducer.ts";

/**
 * One screenplay-style turn block. Speaker in the left margin in caps,
 * dialogue flush-left in the right column.
 *
 * Rendering modes:
 *  - While streaming: split text on double-newline into plain <p>s.
 *    Cheap to re-render every chunk; no thrash. Blinking cursor on
 *    the last paragraph.
 *  - After turn.end: parse the final `full_text` as Markdown once,
 *    cache the HTML, drop the cursor. Proper code blocks, lists,
 *    bold/italic, inline links — but only after streaming is done,
 *    so we don't reparse the partial tree on every chunk.
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

// Configure marked once at module load: GFM + line breaks (chat-like).
// marked@14 passes raw HTML through (sanitization is the caller's job),
// so every output goes through DOMPurify before innerHTML. The result:
// formatted markdown + safe against XSS in transcript content.
marked.use({ gfm: true, breaks: true });

export function SessionTurnCard({
  turn,
  colorIndex,
  isHuman,
  role,
}: SessionTurnCardProps) {
  const colorClass = isHuman ? "human" : `p${(colorIndex % 4) + 1}`;
  const isStreaming = turn.status === "streaming";

  // Memoize the markdown render. While streaming we don't compute it;
  // useMemo + dependency on (isStreaming, text) means we parse exactly
  // once on the transition to "complete".
  const markdownHtml = useMemo(() => {
    if (isStreaming) return null;
    try {
      const rawHtml = marked.parse(turn.text, { async: false }) as string;
      // DOMPurify strips <script>, on*-handlers, javascript: URIs, etc.
      return DOMPurify.sanitize(rawHtml);
    } catch {
      return null;
    }
  }, [isStreaming, turn.text]);

  // Streaming path: cheap paragraph split for incremental append.
  const paragraphs =
    turn.text.length > 0 ? turn.text.split(/\n{2,}/) : [""];

  return (
    <div
      className="session-turn"
      data-testid="session-turn"
      data-turn-id={turn.turn_id}
      data-status={turn.status}
    >
      <div className={`session-speaker ${colorClass}`}>
        {turn.speaker}
        {role && (
          <span className="session-speaker-meta">
            {role}
            {isStreaming ? " · speaking" : ""}
          </span>
        )}
      </div>
      <div
        className={`session-lines${isStreaming ? " streaming" : " complete"}`}
        data-testid="session-turn-lines"
      >
        <span className="session-line-num">{formatTimestamp(turn.timestamp)}</span>
        {isStreaming || markdownHtml === null ? (
          paragraphs.map((p, i) => {
            const isLast = i === paragraphs.length - 1;
            return (
              <p key={i}>
                {p}
                {isLast && isStreaming && (
                  <span className="session-cursor" aria-hidden="true" />
                )}
              </p>
            );
          })
        ) : (
          <div
            className="session-markdown"
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        )}
      </div>
    </div>
  );
}
