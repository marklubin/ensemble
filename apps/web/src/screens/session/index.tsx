import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { ModeratorAction, SeatInfo, SessionMeta, SseEvent } from "@ensemble/shared";

import { openEventStream } from "../../lib/event-stream.ts";
import { createUiBridgeClient, type UiBridgeClient } from "../../lib/ui-bridge-client.ts";
import { SessionTurnCard } from "../../components/SessionTurnCard.tsx";
import { SessionModeratorCard } from "../../components/SessionModeratorCard.tsx";
import { SessionMemoryPanel } from "../../components/SessionMemoryPanel.tsx";
import { SessionDock } from "../../components/SessionDock.tsx";

import { initialSessionState, sessionReducer } from "./reducer.ts";
import "./session.css";

/**
 * Session metadata fetched from `GET /sessions/:id`. Re-exported from
 * @ensemble/shared so callers can keep importing from this module.
 */
export type { SessionMeta } from "@ensemble/shared";

export interface SessionScreenProps {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override EventSource (tests). */
  EventSourceCtor?: typeof EventSource;
  /** Test-only: feed a scripted SSE stream URL instead of `/sessions/:id/events`. */
  eventsUrlOverride?: string;
  /** Test-only: pre-supplied metadata; skips the fetch call. */
  metaOverride?: SessionMeta;
  /** Test-only: pre-supplied reducer events injected before mount. */
  initialEvents?: SseEvent[];
}

function reducerInit(events: SseEvent[] | undefined) {
  let s = initialSessionState;
  for (const e of events ?? []) s = sessionReducer(s, e);
  return s;
}

export function SessionScreen(props: SessionScreenProps = {}) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = params.id ?? "unknown";
  const isModerator = searchParams.get("moderator") === "1";

  const [state, dispatch] = useReducer(
    sessionReducer,
    props.initialEvents,
    reducerInit,
  );
  const [meta, setMeta] = useState<SessionMeta | null>(props.metaOverride ?? null);
  const [memoryFor, setMemoryFor] = useState<SeatInfo | null>(null);
  const [bridgeFocusTurn, setBridgeFocusTurn] = useState<string | null>(null);

  const fetchImpl = props.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

  // Fetch session metadata.
  useEffect(() => {
    if (props.metaOverride || !fetchImpl) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchImpl(`/sessions/${sessionId}`);
        if (!r.ok) return;
        const data = (await r.json()) as SessionMeta;
        if (!cancelled) setMeta(data);
      } catch {
        // Silently fall back to bare-bones session; the SSE feed still
        // populates the transcript.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, fetchImpl, props.metaOverride]);

  // Subscribe to SSE feed.
  useEffect(() => {
    const url = props.eventsUrlOverride ?? `/sessions/${sessionId}/events`;
    let handle: ReturnType<typeof openEventStream> | null = null;
    try {
      handle = openEventStream({
        url,
        EventSourceCtor: props.EventSourceCtor,
        handlers: {
          any: (event: SseEvent) => dispatch(event),
        },
      });
    } catch {
      // No EventSource in this env (e.g. tests without happy-dom polyfill).
      // The screen still renders if `initialEvents` was supplied.
    }
    return () => handle?.close();
  }, [sessionId, props.eventsUrlOverride, props.EventSourceCtor]);

  // UiBridge for the human seat.
  const bridgeRef = useRef<UiBridgeClient | null>(null);
  useEffect(() => {
    const humanSeat = meta?.human_seat_id ?? null;
    if (!humanSeat) return;
    const client = createUiBridgeClient({
      sessionId,
      seatId: humanSeat,
      fetchImpl,
      EventSourceCtor: props.EventSourceCtor,
      onFocus: (msg) => setBridgeFocusTurn(msg.turn_id),
      onBlur: () => setBridgeFocusTurn(null),
    });
    bridgeRef.current = client;
    return () => {
      client.close();
      bridgeRef.current = null;
    };
  }, [sessionId, meta?.human_seat_id, fetchImpl, props.EventSourceCtor]);

  // Auto-scroll on new entries.
  const pageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    pageRef.current?.scrollTo?.({ top: pageRef.current.scrollHeight, behavior: "smooth" });
  }, [state.entries.length]);

  const cast = meta?.cast ?? [];
  const speakerColorIndex = useMemo(() => {
    const map: Record<string, number> = {};
    cast.forEach((s, i) => (map[s.seat_id] = i));
    return map;
  }, [cast]);

  const onModeratorAction = useCallback(
    async (action: ModeratorAction) => {
      if (!fetchImpl) return;
      const url = action.tool === "inject"
        ? `/sessions/${sessionId}/moderator/inject`
        : `/sessions/${sessionId}/moderator/${action.tool}`;
      try {
        await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action.args),
        });
      } catch {
        /* documented in HANDOFF: server proxies these to MCP */
      }
    },
    [fetchImpl, sessionId],
  );

  const onBuzzIn = useCallback(
    async (intent: string, intensity: number) => {
      if (!fetchImpl) return;
      // The HUMAN seat bypasses the SPI for buzz_check (see architecture
      // §Human role). Client POSTs directly to the buzzer endpoint with
      // session+seat scoped credentials inferred from cookie or query.
      try {
        await fetchImpl(`/sessions/${sessionId}/human/buzz`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intent, intensity }),
        });
      } catch {
        /* server endpoint may not be wired yet; documented in HANDOFF */
      }
    },
    [fetchImpl, sessionId],
  );

  return (
    <div className="session" data-testid="session-screen">
      <div className="session-topbar">
        <div className="session-topbar-inner">
          <span className="session-brand">ensemble</span>
          <span className="session-sep" />
          <span className="session-template-badge">
            <span className="dot" />
            {meta?.template ?? "Session"}
          </span>
          <span className="session-crumbs">
            <b>{meta?.scenario ?? "—"}</b>
          </span>
          <div className="session-topbar-actions">
            <button type="button">Change scenario</button>
            <button type="button">Verdict</button>
            <button type="button" className="primary">End &amp; save</button>
          </div>
        </div>
      </div>

      <div className="session-app">
        <div className="session-gutter" />

        <main className="session-page" ref={pageRef}>
          <header className="session-cover">
            <div className="session-cover-kicker">
              A Session{meta ? ` · ${meta.template} template` : ""}
              {state.started_at ? ` · ${state.started_at.slice(0, 10)}` : ""}
            </div>
            <h1>{meta?.scenario ?? "(scenario loading…)"}</h1>
            {meta && (
              <div className="byline">
                {meta.rounds_planned} round{meta.rounds_planned === 1 ? "" : "s"} ·{" "}
                {meta.turn_taking.replace("-", " ")}
              </div>
            )}
            <div className="meta">
              <span>
                Round {state.current_round ?? 0}
                {meta ? ` of ${meta.rounds_planned}` : ""}
              </span>
              <span className="dot" />
              <span>{state.turn_count} turns</span>
              {meta && (
                <>
                  <span className="dot" />
                  <span>${meta.cost_so_far_usd.toFixed(2)} spent</span>
                </>
              )}
            </div>
            <div className="session-cast">
              {cast.map((seat) => (
                <div key={seat.seat_id} className="session-cast-member">
                  <div className="session-cast-name">{seat.persona_name}</div>
                  <div className="session-cast-role">
                    {seat.role ?? seat.runtime_type}
                  </div>
                  <button
                    type="button"
                    className="session-cast-mem-btn"
                    onClick={() => setMemoryFor(seat)}
                    data-testid={`session-mem-btn-${seat.seat_id}`}
                    aria-label={`Inspect memory for ${seat.persona_name}`}
                  >
                    ◧ memory
                  </button>
                </div>
              ))}
            </div>
          </header>

          {state.entries.map((entry, i) => {
            if (entry.kind === "round_header") {
              return (
                <div className="session-act" key={`r-${entry.round}-${i}`}>
                  <h2>Round {entry.round}</h2>
                </div>
              );
            }
            if (entry.kind === "moderator") {
              return (
                <SessionModeratorCard
                  key={entry.block.id}
                  block={entry.block}
                  cast={cast}
                  isModerator={isModerator}
                  onAction={onModeratorAction}
                />
              );
            }
            if (entry.kind === "notice") {
              return (
                <div
                  key={`n-${i}`}
                  className={`session-notice ${entry.tone}`}
                  data-testid="session-notice"
                  data-tone={entry.tone}
                >
                  {entry.text}
                </div>
              );
            }
            const seat = cast.find((c) => c.seat_id === entry.turn.seat_id);
            const isHuman = !!meta?.human_seat_id && entry.turn.seat_id === meta.human_seat_id;
            const colorIndex = speakerColorIndex[entry.turn.seat_id] ?? 0;
            return (
              <SessionTurnCard
                key={entry.turn.turn_id}
                turn={entry.turn}
                colorIndex={colorIndex}
                isHuman={isHuman}
                role={seat?.role ?? seat?.runtime_type}
              />
            );
          })}

          {state.ended && (
            <div className="session-notice end" data-testid="session-end-footer">
              End of session
            </div>
          )}
        </main>

        <div className="session-gutter right" />
      </div>

      <SessionDock
        state={state}
        cast={cast}
        humanSeatId={meta?.human_seat_id ?? null}
        activeHumanTurnId={bridgeFocusTurn}
        onTypeChunk={(text) => bridgeRef.current?.sendChunk(text)}
        onSubmit={() => bridgeRef.current?.submit()}
        onCancel={(reason?: string) => bridgeRef.current?.cancel(reason)}
        onBuzzIn={onBuzzIn}
        pollMode={meta?.turn_taking === "poll"}
      />

      {memoryFor && (
        <SessionMemoryPanel
          sessionId={sessionId}
          seatId={memoryFor.seat_id}
          seatLabel={memoryFor.persona_name}
          fetchImpl={fetchImpl}
          onClose={() => setMemoryFor(null)}
        />
      )}
    </div>
  );
}

export default SessionScreen;
