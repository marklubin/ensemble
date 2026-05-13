import { Hono } from "hono";

/**
 * Session HTTP routes. Skeleton — agent team will fill in:
 *  - POST /sessions            create a new session (cast, scenario, template)
 *  - GET  /sessions/:id        fetch session state
 *  - GET  /sessions/:id/events SSE stream of session events for the UI
 *  - POST /sessions/:id/start  begin the session (scheduler runs rounds)
 *  - POST /sessions/:id/end    end + save transcript
 */
export const sessions = new Hono();

sessions.get("/", (c) => c.json({ sessions: [], note: "stub" }));
sessions.post("/", (c) =>
  c.json({ error: "not_implemented", todo: "scheduler integration" }, 501),
);
