import type { Template } from "@ensemble/shared";
import { TemplateCard } from "./TemplateCard.tsx";

export interface TemplateGridProps {
  templates: Template[];
  loading: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onUse: (id: string) => void;
  /** Past-session counts keyed by template id (display only). */
  pastCounts?: Record<string, number>;
}

/** Pure presentational grid — loading + empty + populated states. */
export function TemplateGrid({
  templates,
  loading,
  selectedId,
  onSelect,
  onUse,
  pastCounts,
}: TemplateGridProps) {
  if (loading) {
    return (
      <div className="tp-grid" data-state="loading" data-testid="template-grid">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (templates.length === 0) {
    return (
      <div className="tp-grid" data-state="empty" data-testid="template-grid">
        <div className="tp-empty">
          No templates available yet. Build one with “Custom” below.
        </div>
      </div>
    );
  }
  return (
    <div className="tp-grid" data-state="ready" data-testid="template-grid">
      {templates.map((t) => (
        <TemplateCard
          key={t.id}
          template={t}
          selected={selectedId === t.id}
          pastCount={pastCounts?.[t.id]}
          onSelect={() => onSelect(t.id)}
          onUse={() => onUse(t.id)}
        />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="tp-skeleton" data-testid="template-skeleton">
      <div className="bar long" />
      <div className="bar med" />
      <div className="bar short" />
      <div className="bar long" />
      <div className="bar med" />
      <span>Loading templates…</span>
    </div>
  );
}
