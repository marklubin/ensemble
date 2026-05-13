import { useState } from "react";
import type { ModeratorBlockVM } from "../screens/session/reducer.ts";
import type { ModeratorAction, SeatInfo } from "@ensemble/shared";

// Re-export so existing imports from this module keep working.
export type { ModeratorAction } from "@ensemble/shared";

export interface SessionModeratorCardProps {
  block: ModeratorBlockVM;
  /** All cast seats (used to populate moderator action dropdowns). */
  cast: SeatInfo[];
  /** When true, render moderator action buttons + forms. */
  isModerator: boolean;
  onAction?: (action: ModeratorAction) => void;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toTimeString().slice(0, 5);
  } catch {
    return "";
  }
}

export function SessionModeratorCard({
  block,
  cast,
  isModerator,
  onAction,
}: SessionModeratorCardProps) {
  const [openForm, setOpenForm] = useState<null | "force" | "cooldown" | "bypass" | "inject">(null);
  const [forceSeat, setForceSeat] = useState(cast[0]?.seat_id ?? "");
  const [cooldownSeat, setCooldownSeat] = useState(cast[0]?.seat_id ?? "");
  const [cooldownRounds, setCooldownRounds] = useState(1);
  const [cooldownReason, setCooldownReason] = useState("");
  const [bypassSeat, setBypassSeat] = useState(cast[0]?.seat_id ?? "");
  const [bypassReason, setBypassReason] = useState("");
  const [injectText, setInjectText] = useState("");

  const submit = (action: ModeratorAction) => {
    onAction?.(action);
    setOpenForm(null);
  };

  return (
    <div className="session-stage-direction" data-testid="session-moderator-card">
      <div className="session-sd-head">
        <span>Fact-check &amp; framing — Round {block.round}</span>
        <span style={{ opacity: 0.7 }}>{formatTime(block.timestamp)}</span>
      </div>
      {block.tools.length > 0 && (
        <div className="session-sd-tools" data-testid="session-moderator-tools">
          {block.tools.map((t, i) => (
            <span key={i} className="session-sd-tool">
              {t.status === "complete" ? "✓" : "🔍"} {t.tool}
              {t.detail ? `: ${t.detail}` : ""}
            </span>
          ))}
        </div>
      )}
      {block.content.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}

      {isModerator && (
        <div className="session-moderator-controls" data-testid="session-moderator-controls">
          <button
            type="button"
            className="session-mod-btn"
            onClick={() => setOpenForm(openForm === "force" ? null : "force")}
          >
            Force speaker
          </button>
          <button
            type="button"
            className="session-mod-btn"
            onClick={() => setOpenForm(openForm === "cooldown" ? null : "cooldown")}
          >
            Cooldown
          </button>
          <button
            type="button"
            className="session-mod-btn"
            onClick={() => setOpenForm(openForm === "bypass" ? null : "bypass")}
          >
            Bypass
          </button>
          <button
            type="button"
            className="session-mod-btn"
            onClick={() => setOpenForm(openForm === "inject" ? null : "inject")}
          >
            Inject
          </button>

          {openForm === "force" && (
            <div className="session-mod-inline">
              <select
                className="session-mod-select"
                value={forceSeat}
                onChange={(e) => setForceSeat(e.target.value)}
                aria-label="Force speaker seat"
              >
                {cast.map((s) => (
                  <option key={s.seat_id} value={s.seat_id}>
                    {s.persona_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="session-mod-btn"
                onClick={() => submit({ tool: "force_speaker", args: { seat_id: forceSeat } })}
              >
                Apply
              </button>
            </div>
          )}

          {openForm === "cooldown" && (
            <div className="session-mod-inline">
              <select
                className="session-mod-select"
                value={cooldownSeat}
                onChange={(e) => setCooldownSeat(e.target.value)}
                aria-label="Cooldown seat"
              >
                {cast.map((s) => (
                  <option key={s.seat_id} value={s.seat_id}>
                    {s.persona_name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                className="session-mod-input"
                value={cooldownRounds}
                onChange={(e) => setCooldownRounds(Number(e.target.value))}
                aria-label="Cooldown rounds"
                style={{ width: 56 }}
              />
              <input
                type="text"
                placeholder="reason"
                className="session-mod-input"
                value={cooldownReason}
                onChange={(e) => setCooldownReason(e.target.value)}
                aria-label="Cooldown reason"
              />
              <button
                type="button"
                className="session-mod-btn"
                onClick={() =>
                  submit({
                    tool: "cooldown",
                    args: {
                      seat_id: cooldownSeat,
                      rounds: cooldownRounds,
                      reason: cooldownReason,
                    },
                  })
                }
              >
                Apply
              </button>
            </div>
          )}

          {openForm === "bypass" && (
            <div className="session-mod-inline">
              <select
                className="session-mod-select"
                value={bypassSeat}
                onChange={(e) => setBypassSeat(e.target.value)}
                aria-label="Bypass seat"
              >
                {cast.map((s) => (
                  <option key={s.seat_id} value={s.seat_id}>
                    {s.persona_name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="reason"
                className="session-mod-input"
                value={bypassReason}
                onChange={(e) => setBypassReason(e.target.value)}
                aria-label="Bypass reason"
              />
              <button
                type="button"
                className="session-mod-btn"
                onClick={() =>
                  submit({
                    tool: "bypass",
                    args: { seat_id: bypassSeat, reason: bypassReason },
                  })
                }
              >
                Apply
              </button>
            </div>
          )}

          {openForm === "inject" && (
            <div className="session-mod-inject">
              <textarea
                placeholder="Inject moderator message…"
                value={injectText}
                onChange={(e) => setInjectText(e.target.value)}
                aria-label="Inject moderator message"
              />
              <div className="session-mod-inline">
                <button
                  type="button"
                  className="session-mod-btn"
                  onClick={() => {
                    submit({ tool: "inject", args: { content: injectText } });
                    setInjectText("");
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
