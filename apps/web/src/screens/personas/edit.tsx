import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PersonaSpec } from "@ensemble/shared";
import { api } from "../../lib/api-client.ts";
import { PreTopBar } from "../../components/PreTopBar.tsx";
import "./personas.css";

const KNOWN_TOOLS = ["web_search", "memory.read", "memory.write"] as const;
const MEMORY_POLICIES = ["ephemeral", "session-scoped", "persistent"] as const;

interface DraftPersona {
  id: string;
  name: string;
  system_prompt: string;
  role: string;
  voice_signature: string;
  buzz_in_policy: string;
  tools_allowed: string[];
  memory_policy: "ephemeral" | "session-scoped" | "persistent";
}

const EMPTY: DraftPersona = {
  id: "",
  name: "",
  system_prompt: "",
  role: "",
  voice_signature: "",
  buzz_in_policy: "",
  tools_allowed: [],
  memory_policy: "ephemeral",
};

export function PersonaEditScreen() {
  const params = useParams();
  const navigate = useNavigate();
  const idParam = params.id; // undefined for /personas/new
  const isNew = !idParam || idParam === "new";

  const [draft, setDraft] = useState<DraftPersona>(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    api.personas.get(idParam!).then((p) => {
      if (cancelled) return;
      if (!p) {
        setServerError(`Persona "${idParam}" not found.`);
      } else {
        setDraft({
          id: p.id,
          name: p.name,
          system_prompt: p.system_prompt,
          role: p.role ?? "",
          voice_signature: p.voice_signature ?? "",
          buzz_in_policy: p.buzz_in_policy ?? "",
          tools_allowed: p.tools_allowed,
          memory_policy: p.memory_policy,
        });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [idParam, isNew]);

  const validation = useMemo(() => validate(draft, isNew), [draft, isNew]);
  const canSave = Object.keys(validation).length === 0 && !saving;

  function set<K extends keyof DraftPersona>(key: K, value: DraftPersona[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleTool(tool: string) {
    setDraft((d) =>
      d.tools_allowed.includes(tool)
        ? { ...d, tools_allowed: d.tools_allowed.filter((t) => t !== tool) }
        : { ...d, tools_allowed: [...d.tools_allowed, tool] },
    );
  }

  async function handleSave() {
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setSaving(true);
    setServerError(null);
    try {
      const spec: PersonaSpec = PersonaSpec.parse({
        id: isNew ? slugify(draft.name) : draft.id,
        name: draft.name,
        system_prompt: draft.system_prompt,
        role: draft.role || undefined,
        voice_signature: draft.voice_signature || undefined,
        buzz_in_policy: draft.buzz_in_policy || undefined,
        tools_allowed: draft.tools_allowed,
        memory_policy: draft.memory_policy,
      });
      await api.personas.save(spec);
      navigate("/personas");
    } catch (err) {
      setServerError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PreTopBar crumb="Edit persona" showManagePersonas={false} />
        <main className="pe-page">
          <p style={{ fontStyle: "italic", color: "var(--muted)" }}>Loading…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <PreTopBar
        crumb={isNew ? "New persona" : `Edit — ${draft.name || draft.id}`}
        showManagePersonas={false}
      />
      <main className="pe-page">
        <header className="pe-header">
          <h1>
            {isNew ? (
              <>
                A <em>new persona</em>
              </>
            ) : (
              <>
                Editing <em>{draft.name}</em>
              </>
            )}
          </h1>
          <div className="sub">
            Personas are portable specs — same name, different runtimes.
          </div>
        </header>

        <div className="pe-field">
          <label htmlFor="p-name">Name</label>
          <input
            id="p-name"
            type="text"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Alex Chen"
            data-testid="p-name"
          />
          {errors.name && <span className="error">{errors.name}</span>}
        </div>

        <div className="pe-field">
          <label htmlFor="p-role">Role (optional)</label>
          <input
            id="p-role"
            type="text"
            value={draft.role}
            onChange={(e) => set("role", e.target.value)}
            placeholder="Pro · Con · Host · Moderator · …"
          />
          <span className="hint">
            Used by templates to constrain casting (e.g. Debate needs Pro/Con).
          </span>
        </div>

        <div className="pe-field">
          <label htmlFor="p-system">System prompt</label>
          <textarea
            id="p-system"
            className="system-prompt"
            value={draft.system_prompt}
            onChange={(e) => set("system_prompt", e.target.value)}
            placeholder="You are Alex Chen, a measured infrastructure engineer…"
            data-testid="p-system"
          />
          {errors.system_prompt && (
            <span className="error">{errors.system_prompt}</span>
          )}
        </div>

        <div className="pe-field">
          <label htmlFor="p-voice">Voice signature</label>
          <textarea
            id="p-voice"
            value={draft.voice_signature}
            onChange={(e) => set("voice_signature", e.target.value)}
            placeholder="Even-toned, leads with the load-bearing claim…"
          />
          <span className="hint">
            Short description of cadence and rhetorical moves. Surfaces in the
            cast list and as a system-prompt hint.
          </span>
        </div>

        <div className="pe-field">
          <label htmlFor="p-buzz">Buzz-in policy</label>
          <textarea
            id="p-buzz"
            value={draft.buzz_in_policy}
            onChange={(e) => set("buzz_in_policy", e.target.value)}
            placeholder="Speak when a quantitative claim is unchecked…"
          />
          <span className="hint">
            Natural-language meta-rule for when this persona wants to talk
            (used by self-select turn-taking).
          </span>
        </div>

        <div className="pe-field">
          <label>Tools allowed</label>
          <div className="pe-tools">
            {KNOWN_TOOLS.map((t) => {
              const on = draft.tools_allowed.includes(t);
              return (
                <label
                  key={t}
                  className={on ? "checked" : ""}
                  data-testid={`tool-${t}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleTool(t)}
                  />
                  {t}
                </label>
              );
            })}
          </div>
        </div>

        <div className="pe-field">
          <label>Memory policy</label>
          <div className="pe-radio-row">
            {MEMORY_POLICIES.map((mp) => (
              <label key={mp}>
                <input
                  type="radio"
                  name="memory_policy"
                  checked={draft.memory_policy === mp}
                  onChange={() => set("memory_policy", mp)}
                />
                {mp}
              </label>
            ))}
          </div>
        </div>

        <div className="pe-footer">
          <Link to="/personas" className="pe-cancel">
            ← Cancel
          </Link>
          <button
            type="button"
            className="pe-save"
            onClick={handleSave}
            disabled={!canSave}
            data-testid="p-save"
          >
            {saving ? "Saving…" : isNew ? "Create persona" : "Save changes"}
          </button>
          <span className="pe-errors">
            {serverError ?? Object.values(validation)[0] ?? ""}
          </span>
        </div>
      </main>
    </>
  );
}

function validate(d: DraftPersona, isNew: boolean): Record<string, string> {
  const errs: Record<string, string> = {};
  if (d.name.trim().length === 0) errs.name = "Name is required";
  if (d.system_prompt.trim().length === 0)
    errs.system_prompt = "System prompt is required";
  if (isNew && slugify(d.name).length === 0) {
    errs.name = "Name must contain at least one letter or number";
  }
  return errs;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default PersonaEditScreen;
