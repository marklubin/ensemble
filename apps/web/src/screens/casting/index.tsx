import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PersonaSpec, Template } from "@ensemble/shared";
import {
  api,
  type CreateSessionRequest,
} from "../../lib/api-client.ts";
import { PreTopBar } from "../../components/PreTopBar.tsx";
import "./casting.css";

interface CastSeatDraft {
  /** Stable client-side seat id (used for keys; server may renumber). */
  seat_id: string;
  persona_id: string;
  role: string; // "" = none
  runtime_type: "managed-agents" | "claude-code" | "human";
}

let seatCounter = 0;
function freshSeat(): CastSeatDraft {
  seatCounter += 1;
  return {
    seat_id: `seat-${seatCounter}`,
    persona_id: "",
    role: "",
    runtime_type: "managed-agents",
  };
}

export function CastingScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const templateId = params.get("template");

  const [template, setTemplate] = useState<Template | null>(null);
  const [personas, setPersonas] = useState<PersonaSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [seats, setSeats] = useState<CastSeatDraft[]>(() => [
    freshSeat(),
    freshSeat(),
  ]);
  const [scenario, setScenario] = useState("");
  const [lengthMode, setLengthMode] = useState<"open-ended" | "n-rounds">(
    "open-ended",
  );
  const [rounds, setRounds] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.templates.list(), api.personas.list()])
      .then(([ts, ps]) => {
        if (cancelled) return;
        const t = ts.find((x) => x.id === templateId) ?? null;
        setTemplate(t);
        setPersonas(ps);
        if (!t) {
          setLoadError(`Template "${templateId ?? "(missing)"}" not found.`);
        } else if (t.default_rounds) {
          setRounds(t.default_rounds);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Auto-seed seats with required roles once template + personas loaded.
  useEffect(() => {
    if (!template) return;
    if (template.required_roles.length === 0) return;
    setSeats((current) => {
      // If user has already filled anything in, don't overwrite.
      if (current.some((s) => s.persona_id !== "" || s.role !== "")) {
        return current;
      }
      const seeded: CastSeatDraft[] = [];
      for (const req of template.required_roles) {
        for (let i = 0; i < req.min; i++) {
          seatCounter += 1;
          seeded.push({
            seat_id: `seat-${seatCounter}`,
            persona_id: "",
            role: req.role,
            runtime_type: "managed-agents",
          });
        }
      }
      // Pad to min_cast.
      while (seeded.length < template.min_cast) {
        seeded.push(freshSeat());
      }
      return seeded;
    });
  }, [template]);

  const errors = useMemo(
    () => validateCast(seats, scenario, template),
    [seats, scenario, template],
  );
  const canSubmit = template !== null && errors.length === 0 && !submitting;

  function updateSeat(seat_id: string, patch: Partial<CastSeatDraft>) {
    setSeats((s) =>
      s.map((seat) => (seat.seat_id === seat_id ? { ...seat, ...patch } : seat)),
    );
  }
  function removeSeat(seat_id: string) {
    setSeats((s) => s.filter((seat) => seat.seat_id !== seat_id));
  }
  function addSeat() {
    setSeats((s) => [...s, freshSeat()]);
  }

  async function handleSubmit() {
    if (!template || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const req: CreateSessionRequest = {
      template_id: template.id,
      scenario,
      cast: seats.map((s) => ({
        seat_id: s.seat_id,
        persona_id: s.persona_id,
        role: s.role || undefined,
        runtime_type: s.runtime_type,
      })),
      length:
        lengthMode === "open-ended"
          ? { kind: "open-ended" }
          : { kind: "n-rounds", rounds },
    };
    try {
      const { session_id } = await api.sessions.create(req);
      navigate(`/session/${encodeURIComponent(session_id)}`);
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <PreTopBar crumb="Cast" />
        <main className="cast-page">
          <p style={{ fontStyle: "italic", color: "var(--muted)" }}>
            Loading template…
          </p>
        </main>
      </>
    );
  }

  if (loadError || !template) {
    return (
      <>
        <PreTopBar crumb="Cast" />
        <main className="cast-page">
          <div className="cast-header">
            <div className="kicker">Cast call</div>
            <h1>
              <em>Template not found.</em>
            </h1>
            <p className="sub">{loadError ?? "No template id provided."}</p>
          </div>
          <Link to="/" className="cast-back">
            ← Back to templates
          </Link>
        </main>
      </>
    );
  }

  const allowedRoles = roleOptions(template);

  return (
    <>
      <PreTopBar crumb={`Cast — ${template.name}`} />
      <main className="cast-page">
        <header className="cast-header">
          <div className="kicker">Cast call</div>
          <h1>
            Who's playing <em>{template.name}</em> today?
          </h1>
          <p className="sub">{template.description}</p>
        </header>

        <div className="cast-section">Constraints</div>
        <ConstraintsBlock template={template} seats={seats} />

        <div className="cast-section">Cast</div>
        <div className="cast-seats" data-testid="cast-seats">
          {seats.map((seat, i) => (
            <div
              key={seat.seat_id}
              className="cast-seat"
              data-testid={`cast-seat-${i}`}
            >
              <span className="idx">{i + 1}.</span>
              <select
                aria-label={`Persona for seat ${i + 1}`}
                value={seat.persona_id}
                onChange={(e) =>
                  updateSeat(seat.seat_id, { persona_id: e.target.value })
                }
              >
                <option value="">— Select persona —</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role ? ` (${p.role})` : ""}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Role for seat ${i + 1}`}
                value={seat.role}
                onChange={(e) =>
                  updateSeat(seat.seat_id, { role: e.target.value })
                }
                disabled={allowedRoles.length === 0}
              >
                <option value="">{allowedRoles.length === 0 ? "(no role)" : "— Role —"}</option>
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Runtime for seat ${i + 1}`}
                value={seat.runtime_type}
                onChange={(e) =>
                  updateSeat(seat.seat_id, {
                    runtime_type: e.target
                      .value as CastSeatDraft["runtime_type"],
                  })
                }
              >
                <option value="managed-agents">Managed Agents</option>
                <option value="claude-code">Claude Code</option>
                <option value="human">Human (you)</option>
              </select>
              <button
                type="button"
                className="remove"
                onClick={() => removeSeat(seat.seat_id)}
                aria-label={`Remove seat ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="cast-add-seat"
          onClick={addSeat}
          disabled={
            template.max_cast !== undefined && seats.length >= template.max_cast
          }
        >
          + Add seat
        </button>

        <div className="cast-section">Scenario</div>
        <div className="cast-field">
          <label htmlFor="scenario">
            {scenarioPrompt(template.scenario_format)}
          </label>
          <textarea
            id="scenario"
            data-testid="scenario-input"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            placeholder={scenarioPlaceholder(template.scenario_format)}
          />
        </div>

        <div className="cast-section">Length</div>
        <div className="cast-length">
          <label>
            <input
              type="radio"
              name="length"
              checked={lengthMode === "open-ended"}
              onChange={() => setLengthMode("open-ended")}
            />
            Open-ended (you end it)
          </label>
          <label>
            <input
              type="radio"
              name="length"
              checked={lengthMode === "n-rounds"}
              onChange={() => setLengthMode("n-rounds")}
            />
            <input
              type="number"
              min={1}
              max={20}
              value={rounds}
              onChange={(e) => setRounds(parseInt(e.target.value, 10) || 1)}
              aria-label="Number of rounds"
              disabled={lengthMode !== "n-rounds"}
            />
            rounds
          </label>
        </div>

        <div className="cast-footer">
          <Link to="/" className="cast-back">
            ← Back
          </Link>
          <button
            type="button"
            className="cast-submit"
            data-testid="cast-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Starting…" : "Start session →"}
          </button>
          <span className="cast-errors" data-testid="cast-errors">
            {submitError ?? errors[0] ?? ""}
          </span>
        </div>
      </main>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function ConstraintsBlock({
  template,
  seats,
}: {
  template: Template;
  seats: CastSeatDraft[];
}) {
  const lines: Array<{ text: string; ok: boolean }> = [];
  lines.push({
    text: `At least ${template.min_cast} seats (currently ${seats.length})`,
    ok: seats.length >= template.min_cast,
  });
  if (template.max_cast !== undefined) {
    lines.push({
      text: `At most ${template.max_cast} seats`,
      ok: seats.length <= template.max_cast,
    });
  }
  for (const req of template.required_roles) {
    const have = seats.filter((s) => s.role === req.role).length;
    lines.push({
      text: `${req.min}+ seats with role "${req.role}" (currently ${have})`,
      ok: have >= req.min,
    });
  }
  return (
    <div className="cast-constraints">
      <div>
        <strong>{template.name}</strong> needs:
      </div>
      <ul>
        {lines.map((l, i) => (
          <li key={i} className={l.ok ? "ok" : "miss"}>
            {l.ok ? "✓" : "✗"} {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function validateCast(
  seats: CastSeatDraft[],
  scenario: string,
  template: Template | null,
): string[] {
  if (!template) return ["No template loaded"];
  const errors: string[] = [];
  if (seats.length < template.min_cast) {
    errors.push(`Need at least ${template.min_cast} seats`);
  }
  if (template.max_cast !== undefined && seats.length > template.max_cast) {
    errors.push(`At most ${template.max_cast} seats allowed`);
  }
  if (seats.some((s) => !s.persona_id)) {
    errors.push("Every seat needs a persona");
  }
  for (const req of template.required_roles) {
    const have = seats.filter((s) => s.role === req.role).length;
    if (have < req.min) {
      errors.push(`Need ${req.min} more "${req.role}" seat(s)`);
      break;
    }
  }
  if (scenario.trim().length === 0) {
    errors.push("Scenario can't be empty");
  }
  return errors;
}

function roleOptions(template: Template): string[] {
  return template.required_roles.map((r) => r.role);
}

function scenarioPrompt(fmt: Template["scenario_format"]): string {
  switch (fmt) {
    case "motion":
      return "The motion (what's being debated)";
    case "question":
      return "The question on the table";
    case "scenario":
      return "Scenario / situation";
    case "document":
      return "Document the cast is discussing";
    case "open":
      return "Kickoff prompt";
  }
}
function scenarioPlaceholder(fmt: Template["scenario_format"]): string {
  switch (fmt) {
    case "motion":
      return "Resolved: small teams should choose RAG over fine-tuning in 2026.";
    case "question":
      return "What's the right shape of memory for a 2026 agent stack?";
    case "scenario":
      return "It's 2027. Your team is reviewing last year's roadmap…";
    case "document":
      return "We're reviewing the attached spec for…";
    case "open":
      return "Anything you'd like the cast to react to — a doc, a question, a hot take.";
  }
}

export default CastingScreen;
