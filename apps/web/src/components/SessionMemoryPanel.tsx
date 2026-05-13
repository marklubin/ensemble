import { useEffect, useState } from "react";

export interface MemoryEntry {
  key: string;
  value: unknown;
}

export interface SessionMemoryPanelProps {
  sessionId: string;
  seatId: string;
  seatLabel: string;
  /** Inject for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  onClose: () => void;
}

interface RowState {
  key: string;
  value: string;       // JSON-stringified for editing
  editing: boolean;
  draft: string;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function SessionMemoryPanel({
  sessionId,
  seatId,
  seatLabel,
  fetchImpl,
  onClose,
}: SessionMemoryPanelProps) {
  const fetcher = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const [rows, setRows] = useState<RowState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!fetcher) {
        setError("fetch unavailable");
        setLoaded(true);
        return;
      }
      try {
        const r = await fetcher(`/sessions/${sessionId}/memory/${seatId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as MemoryEntry[];
        if (cancelled) return;
        setRows(
          data.map((e) => ({
            key: e.key,
            value: stringify(e.value),
            editing: false,
            draft: stringify(e.value),
          })),
        );
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, seatId, fetcher]);

  const save = async (idx: number) => {
    const row = rows[idx];
    if (!row || !fetcher) return;
    const value = parseValue(row.draft);
    try {
      await fetcher(`/sessions/${sessionId}/memory/${seatId}/${encodeURIComponent(row.key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setRows((rs) =>
      rs.map((r, i) =>
        i === idx ? { ...r, value: stringify(value), editing: false, draft: stringify(value) } : r,
      ),
    );
  };

  const remove = async (idx: number) => {
    const row = rows[idx];
    if (!row || !fetcher) return;
    try {
      await fetcher(`/sessions/${sessionId}/memory/${seatId}/${encodeURIComponent(row.key)}`, {
        method: "DELETE",
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setRows((rs) => rs.filter((_, i) => i !== idx));
  };

  return (
    <aside
      className="session-memory-panel"
      data-testid="session-memory-panel"
      role="dialog"
      aria-label={`Memory for ${seatLabel}`}
    >
      <div className="session-memory-header">
        <strong>Memory · {seatLabel}</strong>
        <button
          type="button"
          className="session-memory-close"
          onClick={onClose}
          aria-label="Close memory panel"
        >
          ×
        </button>
      </div>
      <div className="session-memory-body">
        {error && (
          <div className="session-memory-empty" style={{ color: "var(--debate)" }}>
            Failed to load: {error}
          </div>
        )}
        {!error && loaded && rows.length === 0 && (
          <div className="session-memory-empty">No memory entries.</div>
        )}
        {rows.map((row, idx) => (
          <div key={row.key} className="session-memory-row" data-testid="session-memory-row">
            <div className="session-memory-key">{row.key}</div>
            <div className="session-memory-value">
              {row.editing ? (
                <textarea
                  value={row.draft}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r, i) => (i === idx ? { ...r, draft: e.target.value } : r)),
                    )
                  }
                  aria-label={`Edit value for ${row.key}`}
                />
              ) : (
                row.value
              )}
            </div>
            <div className="session-memory-row-actions">
              {row.editing ? (
                <>
                  <button type="button" className="session-memory-btn" onClick={() => save(idx)}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="session-memory-btn"
                    onClick={() =>
                      setRows((rs) =>
                        rs.map((r, i) => (i === idx ? { ...r, editing: false, draft: r.value } : r)),
                      )
                    }
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="session-memory-btn"
                    onClick={() =>
                      setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, editing: true } : r)))
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="session-memory-btn danger"
                    onClick={() => remove(idx)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
