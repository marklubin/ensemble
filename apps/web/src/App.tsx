import { Routes, Route, Link } from "react-router-dom";

/**
 * Router shell. Bootstrap (Phase 0) ships just the placeholder routes
 * below. Phase 1F (UX Pre-session) replaces the templates / casting /
 * personas routes with real screens. Phase 1G (UX In-session) replaces
 * /session/:id with the screenplay UI.
 *
 * The orchestrator (Phase 2) is the only one who edits this file
 * during the parallel phase, to wire each agent's screens in.
 */
export function App() {
  return (
    <div style={{ fontFamily: '"Iowan Old Style", Palatino, Georgia, serif' }}>
      <header style={{ padding: "12px 24px", borderBottom: "1px solid #c9bfa9" }}>
        <Link to="/" style={{ color: "#6a4c1f", textDecoration: "none", fontStyle: "italic" }}>
          ensemble
        </Link>
      </header>
      <Routes>
        <Route path="/" element={<Placeholder name="Templates picker (UX-Pre)" />} />
        <Route path="/casting" element={<Placeholder name="Casting (UX-Pre)" />} />
        <Route path="/personas" element={<Placeholder name="Persona library (UX-Pre)" />} />
        <Route path="/session/:id" element={<Placeholder name="Active session (UX-Session)" />} />
        <Route path="*" element={<Placeholder name="404" />} />
      </Routes>
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <main style={{ padding: 40, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontWeight: 600 }}>{name}</h1>
      <p style={{ color: "#8a8278", fontStyle: "italic" }}>
        Phase 0 placeholder. A Phase 1 agent will replace this.
      </p>
    </main>
  );
}
