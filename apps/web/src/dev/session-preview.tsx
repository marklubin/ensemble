/**
 * Standalone preview shell for the session screen.
 *
 * Mounts at /session-preview.html (separate vite entry — see
 * `apps/web/session-preview.html`). Lets agent-g iterate on the screen
 * without depending on the orchestrator's router wiring, which is
 * blocked during Phase 1.
 *
 * Drives a scripted SSE feed by feeding fixture events into the
 * reducer directly (the screen accepts `initialEvents` for exactly this
 * reason).
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import "../theme.css";

import { SessionScreen } from "../screens/session/index.tsx";
import {
  SAMPLE_SESSION_EVENTS,
  SAMPLE_SESSION_META,
} from "../fixtures/sample-session.ts";

function PreviewShell() {
  return (
    <MemoryRouter initialEntries={["/session/sample?moderator=1"]}>
      <Routes>
        <Route
          path="/session/:id"
          element={
            <SessionScreen
              metaOverride={SAMPLE_SESSION_META}
              initialEvents={SAMPLE_SESSION_EVENTS}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreviewShell />
  </React.StrictMode>,
);
