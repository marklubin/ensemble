import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PersonaSpec, Template } from "@ensemble/shared";
import { api } from "../../lib/api-client.ts";
import { PreTopBar } from "../../components/PreTopBar.tsx";
import { TemplateGrid } from "./TemplateGrid.tsx";
import "./templates.css";

/** Recent-sessions strip is local-only for v1 (no history endpoint yet). */
const RECENT_SESSIONS: Array<{
  template_id: "debate" | "roundtable";
  template_label: string;
  topic: string;
  cast: string[];
  meta: string;
}> = [
  {
    template_id: "debate",
    template_label: "Debate",
    topic: "Has the AI agent hype cycle peaked?",
    cast: ["Alex Chen", "Jordan Rivera", "Dr. Sarah Chen"],
    meta: "Round 3 in progress · today, 13:48",
  },
  {
    template_id: "roundtable",
    template_label: "Roundtable",
    topic: "Kinelo Q3 retro — what would we change?",
    cast: ["Keith", "Ian", "Jon", "Mark", "Peter"],
    meta: "Concluded · 3 days ago",
  },
  {
    template_id: "debate",
    template_label: "Debate",
    topic: "Should small teams choose RAG over fine-tuning in 2026?",
    cast: ["Alex Chen", "Jordan Rivera"],
    meta: "Concluded · last week",
  },
];

/** Past-session counts — display only, no backend yet. */
const PAST_COUNTS: Record<string, number> = { debate: 12, roundtable: 3 };

export function TemplatesScreen() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [personas, setPersonas] = useState<PersonaSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.templates.list(), api.personas.list()])
      .then(([ts, ps]) => {
        if (cancelled) return;
        setTemplates(ts);
        setPersonas(ps);
        // Select the first one to mirror the mockup's default selection.
        if (ts.length > 0) setSelectedId(ts[0]!.id);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Failed to load templates/personas", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleUse(id: string) {
    navigate(`/casting?template=${encodeURIComponent(id)}`);
  }

  return (
    <>
      <PreTopBar crumb="New session" />
      <main className="tp-page">
        <header className="tp-lead">
          <div className="tp-kicker">A new scene</div>
          <h1>
            Who's at the table, and{" "}
            <em>what are they here to do?</em>
          </h1>
          <p className="tp-sub">
            Pick a format. You'll cast the personas, set the scenario, and
            start the read on the next screen.
          </p>
        </header>

        <div className="tp-section">
          <h2>Templates</h2>
        </div>

        <TemplateGrid
          templates={templates}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUse={handleUse}
          pastCounts={PAST_COUNTS}
        />

        <div className="tp-custom" data-testid="custom-row">
          <div className="icon">+</div>
          <div className="text">
            <strong>Or build a custom format</strong>
            <span>
              Pick your own turn-taking, moderator role, and conclude action.
              Save it as a reusable template.
            </span>
          </div>
          <button type="button" className="tp-btn" disabled title="Coming soon">
            Build custom
          </button>
        </div>

        <div className="tp-section">
          <h2>Pick up where you left off</h2>
        </div>

        <div className="tp-recent">
          {RECENT_SESSIONS.map((r, i) => (
            <article key={i} className="tp-recent-card">
              <div className={`r-template ${r.template_id}`}>
                {r.template_label}
              </div>
              <div className="r-topic">{r.topic}</div>
              <div className="r-cast">
                <em>{r.cast.join(", ")}</em>
              </div>
              <div className="r-meta">{r.meta}</div>
            </article>
          ))}
        </div>

        <div className="tp-persona-hint">
          <span className="count">{personas.length}</span>
          <span className="label">
            personas in your library — ready to cast in any session.
          </span>
          <a
            href="/personas"
            onClick={(e) => {
              e.preventDefault();
              navigate("/personas");
            }}
          >
            Manage personas →
          </a>
        </div>
      </main>
    </>
  );
}

export default TemplatesScreen;
