import type { PersonaSpec } from "@ensemble/shared";
import type { IPersonaStore } from "./store.ts";

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

/**
 * sqlite-backed persona library. Schema:
 *   CREATE TABLE personas (
 *     id   TEXT PRIMARY KEY,
 *     spec TEXT NOT NULL  -- JSON-encoded PersonaSpec
 *   );
 *
 * Falls back to InMemoryPersonaStore at the call site if bun:sqlite
 * fails to load (per COMMON.md pre-authorized fallback).
 */
export class SqlitePersonaStore implements IPersonaStore {
  private readonly db: SqliteDatabase;
  private readonly stmtAll: SqliteStatement;
  private readonly stmtGet: SqliteStatement;
  private readonly stmtPut: SqliteStatement;
  private readonly stmtDelete: SqliteStatement;
  private readonly stmtCount: SqliteStatement;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personas (
        id   TEXT PRIMARY KEY,
        spec TEXT NOT NULL
      );
    `);
    this.stmtAll = this.db.prepare(`SELECT spec FROM personas ORDER BY id ASC`);
    this.stmtGet = this.db.prepare(`SELECT spec FROM personas WHERE id = ?`);
    this.stmtPut = this.db.prepare(
      `INSERT INTO personas (id, spec) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET spec = excluded.spec`,
    );
    this.stmtDelete = this.db.prepare(`DELETE FROM personas WHERE id = ?`);
    this.stmtCount = this.db.prepare(`SELECT COUNT(*) AS n FROM personas`);
  }

  static async open(path: string): Promise<SqlitePersonaStore> {
    const mod = (await import("bun:sqlite")) as unknown as {
      Database: SqliteCtor;
    };
    const db = new mod.Database(path);
    return new SqlitePersonaStore(db);
  }

  list(): PersonaSpec[] {
    const rows = this.stmtAll.all() as Array<{ spec: string }>;
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.spec) as PersonaSpec;
        } catch {
          return null;
        }
      })
      .filter((p): p is PersonaSpec => p !== null);
  }

  get(id: string): PersonaSpec | undefined {
    const row = this.stmtGet.get(id) as { spec: string } | undefined | null;
    if (!row) return undefined;
    try {
      return JSON.parse(row.spec) as PersonaSpec;
    } catch {
      return undefined;
    }
  }

  put(spec: PersonaSpec): PersonaSpec {
    this.stmtPut.run(spec.id, JSON.stringify(spec));
    return spec;
  }

  delete(id: string): boolean {
    const result = this.stmtDelete.run(id) as { changes?: number } | unknown;
    if (typeof result === "object" && result !== null && "changes" in result) {
      return (result as { changes: number }).changes > 0;
    }
    return true;
  }

  count(): number {
    const row = this.stmtCount.get() as { n: number };
    return Number(row?.n ?? 0);
  }
}
