import { Routes, Route } from "react-router-dom";

import { TemplatesScreen } from "./screens/templates/index.tsx";
import { CastingScreen } from "./screens/casting/index.tsx";
import { PersonasScreen } from "./screens/personas/index.tsx";
import { PersonaEditScreen } from "./screens/personas/edit.tsx";
import { SessionScreen } from "./screens/session/index.tsx";

export function App() {
  return (
    <div style={{ fontFamily: '"Iowan Old Style", Palatino, Georgia, serif' }}>
      {/* Per-screen topbars (PreTopBar / SessionDock) own navigation;
          the global App header is intentionally absent so we don't
          render two bars stacked. */}
      <Routes>
        <Route path="/" element={<TemplatesScreen />} />
        <Route path="/casting" element={<CastingScreen />} />
        <Route path="/personas" element={<PersonasScreen />} />
        <Route path="/personas/new" element={<PersonaEditScreen />} />
        <Route path="/personas/:id" element={<PersonaEditScreen />} />
        <Route path="/session/:id" element={<SessionScreen />} />
        <Route path="*" element={<Placeholder name="404" />} />
      </Routes>
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <main style={{ padding: 40, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontWeight: 600 }}>{name}</h1>
      <p style={{ color: "#8a8278", fontStyle: "italic" }}>Not found.</p>
    </main>
  );
}
