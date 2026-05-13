import type { Template } from "@ensemble/shared";

export interface TemplateCardProps {
  template: Template;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
  pastCount?: number;
}

/** Single template card. Renders cast/turn/moderator/conclusion summary
 *  and a per-template illustration matching the mockup. */
export function TemplateCard({
  template,
  selected,
  onSelect,
  onUse,
  pastCount,
}: TemplateCardProps) {
  const variant: "debate" | "roundtable" | "other" =
    template.id === "debate"
      ? "debate"
      : template.id === "roundtable"
        ? "roundtable"
        : "other";

  return (
    <article
      className={`tp-card${selected ? " is-selected" : ""}`}
      data-template-id={template.id}
      data-testid={`template-card-${template.id}`}
      onClick={onSelect}
    >
      <div className={`tp-corner is-${variant}`}>{template.name}</div>
      <Illustration variant={variant} />
      <h3 className="tp-name">{template.name}</h3>
      <p className="tp-tagline">{template.description}</p>
      <ul className="tp-attrs">
        <li>
          <span className="label">Cast</span>
          <span className="value">{castSummary(template)}</span>
        </li>
        <li>
          <span className="label">Turn order</span>
          <span className="value">{turnSummary(template)}</span>
        </li>
        <li>
          <span className="label">Moderator</span>
          <span className="value">{modSummary(template)}</span>
        </li>
        <li>
          <span className="label">Concludes</span>
          <span className="value">{conclusionSummary(template)}</span>
        </li>
      </ul>
      <div className="tp-actions">
        <button
          type="button"
          className="tp-btn primary"
          data-testid={`use-${template.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onUse();
          }}
        >
          Use {template.name} →
        </button>
        <button
          type="button"
          className="tp-btn ghost"
          onClick={(e) => e.stopPropagation()}
        >
          See example
        </button>
        {pastCount !== undefined && (
          <span className="tp-meta">{pastSessionsLabel(template, pastCount)}</span>
        )}
      </div>
    </article>
  );
}

function castSummary(t: Template): React.ReactNode {
  if (t.required_roles.length > 0) {
    const roles = t.required_roles.map((r) => r.role).join(" or ");
    return (
      <>
        {t.min_cast}+ personas assigned to <strong>{roles}</strong>
      </>
    );
  }
  const range = t.max_cast ? `${t.min_cast}–${t.max_cast}` : `${t.min_cast}+`;
  return `${range} personas, no assigned roles`;
}

function turnSummary(t: Template): string {
  switch (t.turn_taking_mode) {
    case "shuffled":
      return t.required_roles.length > 0
        ? "Alternating, with shuffle each round"
        : "Reshuffled every round";
    case "round-robin":
      return "Fixed round-robin order";
    case "host-driven":
      return "Host picks the next speaker";
    case "poll":
      return "Self-select — whoever wants to speak goes next";
  }
}

function modSummary(t: Template): React.ReactNode {
  if (!t.moderator_present) return "Optional — off by default";
  const tools =
    t.moderator_tools.length > 0
      ? ` via ${t.moderator_tools.join(", ")}`
      : "";
  const role = t.moderator_role ?? "moderator";
  return `Required — ${role}${tools ? ` (${tools.trim()})` : ""}`;
}

function conclusionSummary(t: Template): React.ReactNode {
  switch (t.conclusion_synthesis) {
    case "verdict-with-winner":
      return (
        <>
          With a <strong>verdict</strong> synthesizing strongest arguments
        </>
      );
    case "summary":
      return "Open-ended; ends with a summary";
    case "deal-terms":
      return "With agreed-on deal terms";
    case "action-items":
      return "With action items";
    case "score-card":
      return "With a score card";
    case "none":
      return "When you end the session";
  }
}

function pastSessionsLabel(t: Template, n: number): string {
  if (n === 0) return "No past sessions yet";
  const word = t.name.toLowerCase() === "debate" ? "debate" : t.name.toLowerCase();
  return `${n} past ${word}${n === 1 ? "" : "s"}`;
}

function Illustration({
  variant,
}: {
  variant: "debate" | "roundtable" | "other";
}) {
  if (variant === "debate") {
    return (
      <div className="tp-illustration">
        <div className="ill-line">
          <div className="role-col role p1">PRO</div>
          <div className="dialog-col">Capital follows working systems…</div>
        </div>
        <div className="ill-line">
          <div className="role-col role p2">CON</div>
          <div className="dialog-col">That's the bubble-era sentence.</div>
        </div>
        <div className="mod-line">
          fact-check · <strong>Moderator:</strong> Pro's claim checks out;
          Con's is partially supported…
        </div>
        <div className="ill-line">
          <div className="role-col role p1">PRO</div>
          <div className="dialog-col">
            Right, but the Menlo median is the wrong number to anchor on…
          </div>
        </div>
      </div>
    );
  }
  if (variant === "roundtable") {
    return (
      <div className="tp-illustration">
        <div className="ill-line">
          <div className="role-col role p2">KEITH</div>
          <div className="dialog-col">
            Concur — that's a really good point. The proper Kinelo answer…
          </div>
        </div>
        <div className="ill-line">
          <div className="role-col role p1">MARK</div>
          <div className="dialog-col">
            Right, but routing and lookup need different layers…
          </div>
        </div>
        <div className="ill-line">
          <div className="role-col role p2">PETER</div>
          <div className="dialog-col">
            I'm with Mark on the layering, but I'd add…
          </div>
        </div>
        <div className="ill-line">
          <div className="role-col role p1">IAN</div>
          <div className="dialog-col">
            Can we step back? What's the actual constraint?
          </div>
        </div>
      </div>
    );
  }
  // Generic fallback for future templates
  return (
    <div className="tp-illustration">
      <div className="ill-line">
        <div className="role-col role p1">A</div>
        <div className="dialog-col">…</div>
      </div>
    </div>
  );
}
