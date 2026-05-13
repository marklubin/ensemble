import type { IMemoryStore } from "./store.ts";

/**
 * Durable memory store backed by bun:sqlite.
 *
 * Schema:
 *   CREATE TABLE memory_entries (
 *     session_id TEXT NOT NULL,
 *     seat_id    TEXT NOT NULL,
 *     key        TEXT NOT NULL,
 *     value      TEXT NOT NULL,   -- JSON-encoded
 *     PRIMARY KEY (session_id, seat_id, key)
 *   );
 *
 * Values are stored as JSON strings so we can round-trip arbitrary
 * `unknown` from the MCP tool args. Use `:memory:` as the path to get
 * an ephemeral, per-process database (handy for tests).
 *
 * If `bun:sqlite` import fails at runtime, callers should fall back to
 * the in-memory `MemoryStore` per the pre-authorized fallback in
 * COMMON.md.
 */

interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteStatement {
  run(...args: unknown[]): unknown;
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

type SqliteCtor = new (path: string) => SqliteDatabase;

export class SqliteMemoryStore implements IMemoryStore {
  private readonly db: SqliteDatabase;
  private readonly stmtRead: SqliteStatement;
  private readonly stmtWrite: SqliteStatement;
  private readonly stmtDelete: SqliteStatement;
  private readonly stmtList: SqliteStatement;
  private readonly stmtDump: SqliteStatement;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        session_id TEXT NOT NULL,
        seat_id    TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        PRIMARY KEY (session_id, seat_id, key)
      );
    `);
    this.stmtRead = this.db.prepare(
      `SELECT value FROM memory_entries
        WHERE session_id = ? AND seat_id = ? AND key = ?`,
    );
    this.stmtWrite = this.db.prepare(
      `INSERT INTO memory_entries (session_id, seat_id, key, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id, seat_id, key)
        DO UPDATE SET value = excluded.value`,
    );
    this.stmtDelete = this.db.prepare(
      `DELETE FROM memory_entries
        WHERE session_id = ? AND seat_id = ? AND key = ?`,
    );
    this.stmtList = this.db.prepare(
      `SELECT key FROM memory_entries
        WHERE session_id = ? AND seat_id = ?
        ORDER BY key ASC`,
    );
    this.stmtDump = this.db.prepare(
      `SELECT key, value FROM memory_entries
        WHERE session_id = ? AND seat_id = ?`,
    );
  }

  static async open(path: string): Promise<SqliteMemoryStore> {
    const mod = (await import("bun:sqlite")) as unknown as {
      Database: SqliteCtor;
    };
    const db = new mod.Database(path);
    return new SqliteMemoryStore(db);
  }

  read(sessionId: string, seatId: string, key: string): unknown {
    const row = this.stmtRead.get(sessionId, seatId, key) as
      | { value: string }
      | undefined
      | null;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  }

  write(sessionId: string, seatId: string, key: string, value: unknown): void {
    this.stmtWrite.run(sessionId, seatId, key, JSON.stringify(value ?? null));
  }

  delete(sessionId: string, seatId: string, key: string): boolean {
    const result = this.stmtDelete.run(sessionId, seatId, key) as
      | { changes?: number }
      | unknown;
    if (typeof result === "object" && result !== null && "changes" in result) {
      return (result as { changes: number }).changes > 0;
    }
    return true;
  }

  list(sessionId: string, seatId: string): string[] {
    const rows = this.stmtList.all(sessionId, seatId) as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }

  dump(sessionId: string, seatId: string): Record<string, unknown> {
    const rows = this.stmtDump.all(sessionId, seatId) as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = null;
      }
    }
    return out;
  }

  close(): void {
    this.db.close();
  }
}
