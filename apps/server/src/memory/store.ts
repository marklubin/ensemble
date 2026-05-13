/**
 * Session-scoped memory store. Owned by Ensemble (not the runtime).
 *
 * v0 in-memory; Decisions agent swaps to bun:sqlite when chosen.
 * Namespace: (session_id, seat_id) → Record<string, unknown>.
 */
export class MemoryStore {
  private readonly data = new Map<string, Map<string, unknown>>();

  private key(sessionId: string, seatId: string) {
    return `${sessionId}::${seatId}`;
  }

  read(sessionId: string, seatId: string, k: string): unknown {
    return this.data.get(this.key(sessionId, seatId))?.get(k);
  }

  write(sessionId: string, seatId: string, k: string, v: unknown): void {
    const ns = this.key(sessionId, seatId);
    if (!this.data.has(ns)) this.data.set(ns, new Map());
    this.data.get(ns)!.set(k, v);
  }

  list(sessionId: string, seatId: string): string[] {
    return [...(this.data.get(this.key(sessionId, seatId))?.keys() ?? [])];
  }

  /** For UI inspection */
  dump(sessionId: string, seatId: string): Record<string, unknown> {
    const ns = this.data.get(this.key(sessionId, seatId));
    if (!ns) return {};
    return Object.fromEntries(ns);
  }
}
