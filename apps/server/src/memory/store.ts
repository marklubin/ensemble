/**
 * Session-scoped memory store. Owned by Ensemble (not the runtime).
 *
 * Namespace: (session_id, seat_id) → Record<string, unknown>.
 *
 * Two backends share this interface:
 *   - `MemoryStore` (this file): in-memory, default
 *   - `SqliteMemoryStore` (./sqlite-store.ts): durable, behind MEMORY_BACKEND=sqlite
 *
 * Use `createMemoryStore()` from ./index.ts to pick by config.
 */

export interface IMemoryStore {
  read(sessionId: string, seatId: string, key: string): unknown;
  write(sessionId: string, seatId: string, key: string, value: unknown): void;
  list(sessionId: string, seatId: string): string[];
  /** For UI inspection */
  dump(sessionId: string, seatId: string): Record<string, unknown>;
  /** Optional resource cleanup (sqlite). */
  close?(): void;
}

export class MemoryStore implements IMemoryStore {
  private readonly data = new Map<string, Map<string, unknown>>();

  private key(sessionId: string, seatId: string) {
    return `${sessionId}::${seatId}`;
  }

  read(sessionId: string, seatId: string, k: string): unknown {
    return this.data.get(this.key(sessionId, seatId))?.get(k);
  }

  write(sessionId: string, seatId: string, k: string, v: unknown): void {
    const ns = this.key(sessionId, seatId);
    let bucket = this.data.get(ns);
    if (!bucket) {
      bucket = new Map();
      this.data.set(ns, bucket);
    }
    bucket.set(k, v);
  }

  list(sessionId: string, seatId: string): string[] {
    return [...(this.data.get(this.key(sessionId, seatId))?.keys() ?? [])];
  }

  dump(sessionId: string, seatId: string): Record<string, unknown> {
    const ns = this.data.get(this.key(sessionId, seatId));
    if (!ns) return {};
    return Object.fromEntries(ns);
  }
}
