import { useEffect, useRef, useState } from "react";
import type { SeatInfo } from "@ensemble/shared";
import type { SessionState } from "../screens/session/reducer.ts";
import { queueChips } from "../screens/session/reducer.ts";
import { SessionQueueChip } from "./SessionQueueChip.tsx";

export interface SessionDockProps {
  state: SessionState;
  cast: SeatInfo[];
  /** seat_id of the human seat in this session, if any. */
  humanSeatId: string | null;
  /** Active turn_id for the human seat (server told us to focus). */
  activeHumanTurnId: string | null;
  onTypeChunk?: (text: string) => void;
  onSubmit?: () => void;
  onCancel?: (reason?: string) => void;
  /** Buzz-in (poll mode). Only invoked if `pollMode` is true. */
  onBuzzIn?: (intent: string, intensity: number) => void;
  pollMode?: boolean;
  /** Stop the session — gracefully ends after the in-flight turn. */
  onStop?: () => void;
  /** Inject a moderator message into the transcript. */
  onInject?: (text: string) => void;
  /** True once the server has reported the session as ended. */
  sessionEnded?: boolean;
}

function seatLabel(cast: SeatInfo[], seat_id: string): string {
  const s = cast.find((c) => c.seat_id === seat_id);
  return s?.persona_name ?? seat_id;
}

export function SessionDock({
  state,
  cast,
  humanSeatId,
  activeHumanTurnId,
  onTypeChunk,
  onSubmit,
  onCancel,
  onBuzzIn,
  pollMode,
  onStop,
  onInject,
  sessionEnded,
}: SessionDockProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  const lastEmittedLen = useRef(0);
  const [injectText, setInjectText] = useState("");
  const [showInject, setShowInject] = useState(false);

  // Autofocus when the human seat is the active speaker.
  useEffect(() => {
    if (activeHumanTurnId && taRef.current) {
      taRef.current.focus();
    }
  }, [activeHumanTurnId]);

  // Reset buffer when a new turn starts.
  useEffect(() => {
    setDraft("");
    lastEmittedLen.current = 0;
  }, [activeHumanTurnId]);

  const chips = queueChips(state);
  const speakingSeatId = state.current_speaker_seat;
  const speakingLabel = speakingSeatId ? seatLabel(cast, speakingSeatId) : null;

  const isHumanTurn = !!activeHumanTurnId;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setDraft(next);
    if (isHumanTurn && next.length > lastEmittedLen.current) {
      // Emit new characters as a single chunk (keystroke or paste).
      const delta = next.slice(lastEmittedLen.current);
      lastEmittedLen.current = next.length;
      onTypeChunk?.(delta);
    } else {
      // If the user deleted, reset the watermark so the next addition
      // re-emits cleanly. The server-side bridge accepts character
      // chunks; deletions are a known limitation noted in HANDOFF.
      lastEmittedLen.current = next.length;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.("user-escape");
    }
  };

  const [buzzIntent, setBuzzIntent] = useState("");
  const showBuzz = pollMode && humanSeatId && !isHumanTurn && !state.ended;

  return (
    <div className="session-dock" data-testid="session-dock">
      <div className="session-dock-inner">
        <div className="session-dock-status">
          {speakingLabel ? (
            <span className="session-speaking-indicator">
              <span className="session-speaking-dot" />
              {speakingLabel} is speaking…
            </span>
          ) : (
            <span style={{ fontStyle: "italic" }}>Awaiting turn…</span>
          )}
          <span>
            Round {state.current_round ?? "—"} · {state.turn_count} turns
          </span>
        </div>
        <div className="session-dock-card">
          <textarea
            ref={taRef}
            placeholder={
              isHumanTurn
                ? "You're up — type your turn…"
                : pollMode
                ? "Queue an interjection (Buzz in when ready)…"
                : "Interject as yourself…"
            }
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={!isHumanTurn && !pollMode}
            data-testid="session-dock-textarea"
          />
          {isHumanTurn ? (
            <>
              <button
                type="button"
                className="session-dock-btn"
                onClick={() => onCancel?.("user-cancel")}
              >
                Cancel
              </button>
              <button
                type="button"
                className="session-dock-btn primary"
                onClick={() => onSubmit?.()}
              >
                Submit ⌘↵
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="session-dock-btn"
                onClick={() => setShowInject((s) => !s)}
                disabled={sessionEnded || !onInject}
                data-testid="session-dock-inject"
                title="Inject a moderator message"
              >
                💬 Inject
              </button>
              <button
                type="button"
                className="session-dock-btn"
                onClick={() => {
                  if (
                    confirm(
                      "Stop the session? In-flight turn will finish, then no more inference will run.",
                    )
                  ) {
                    onStop?.();
                  }
                }}
                disabled={sessionEnded || !onStop}
                data-testid="session-dock-stop"
              >
                {sessionEnded ? "⏹ Ended" : "⏹ Stop"}
              </button>
            </>
          )}
        </div>
        {showInject && !isHumanTurn && (
          <div className="session-inject" data-testid="session-inject">
            <textarea
              className="session-mod-input"
              placeholder="Inject a moderator message — the personas will see it on their next turn..."
              value={injectText}
              onChange={(e) => setInjectText(e.target.value)}
              rows={2}
              style={{ flex: 1 }}
              aria-label="Moderator inject"
            />
            <button
              type="button"
              className="session-dock-btn primary"
              disabled={!injectText.trim() || sessionEnded}
              onClick={() => {
                onInject?.(injectText.trim());
                setInjectText("");
                setShowInject(false);
              }}
            >
              Send
            </button>
            <button
              type="button"
              className="session-dock-btn"
              onClick={() => {
                setShowInject(false);
                setInjectText("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {showBuzz && (
          <div className="session-buzz" data-testid="session-buzz">
            <input
              type="text"
              className="session-mod-input"
              placeholder="What do you want to say?"
              value={buzzIntent}
              onChange={(e) => setBuzzIntent(e.target.value)}
              aria-label="Buzz-in intent"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="session-buzz-btn"
              onClick={() => onBuzzIn?.(buzzIntent, 8)}
              disabled={!buzzIntent.trim()}
            >
              Buzz in
            </button>
          </div>
        )}
        <div className="session-dock-queue" data-testid="session-dock-queue">
          Order this round{" "}
          {chips.map((c) => (
            <SessionQueueChip
              key={c.seat_id}
              label={seatLabel(cast, c.seat_id)}
              state={c.state}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
