import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PersonaSpec } from "@ensemble/shared";
import { api } from "../../lib/api-client.ts";
import { PreTopBar } from "../../components/PreTopBar.tsx";
import "./personas.css";

export function PersonasScreen() {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState<PersonaSpec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.personas
      .list()
      .then((ps) => {
        if (!cancelled) setPersonas(ps);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this persona?")) return;
    await api.personas.delete(id);
    setPersonas((ps) => ps.filter((p) => p.id !== id));
  }

  return (
    <>
      <PreTopBar crumb="Persona library" showManagePersonas={false} />
      <main className="pl-page">
        <header className="pl-header">
          <h1>
            Your <em>persona library</em>
          </h1>
          <span className="sub">
            Portable specs — the same persona can play in any session.
          </span>
          <button
            type="button"
            className="pl-new"
            onClick={() => navigate("/personas/new")}
            data-testid="new-persona"
          >
            + New persona
          </button>
        </header>

        {loading ? (
          <p style={{ fontStyle: "italic", color: "var(--muted)" }}>
            Loading…
          </p>
        ) : personas.length === 0 ? (
          <div className="pl-empty">
            No personas yet. Start with{" "}
            <Link to="/personas/new">+ New persona</Link>.
          </div>
        ) : (
          <div className="pl-list" data-testid="persona-list">
            {personas.map((p) => (
              <div
                className="pl-item"
                key={p.id}
                data-testid={`persona-item-${p.id}`}
              >
                <div>
                  <div className="name">{p.name}</div>
                  <div className="role">{p.role ?? "no role"}</div>
                </div>
                <div className="role">{p.memory_policy}</div>
                <div className="voice">
                  {p.voice_signature ?? <em>no voice signature</em>}
                </div>
                <div className="actions">
                  <Link to={`/personas/${encodeURIComponent(p.id)}`}>
                    Edit
                  </Link>
                  <button
                    type="button"
                    className="delete"
                    onClick={() => handleDelete(p.id)}
                    aria-label={`Delete ${p.name}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export default PersonasScreen;
