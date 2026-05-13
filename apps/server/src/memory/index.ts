import { config } from "../config/index.ts";
import { MemoryStore } from "./store.ts";
import type { IMemoryStore } from "./store.ts";
import { SqliteMemoryStore } from "./sqlite-store.ts";

export { MemoryStore } from "./store.ts";
export type { IMemoryStore } from "./store.ts";
export { SqliteMemoryStore } from "./sqlite-store.ts";

/**
 * Pick a memory store based on config. Falls back to in-memory if the
 * sqlite backend is selected but bun:sqlite fails to load (per
 * COMMON.md pre-authorized fallback).
 */
export async function createMemoryStore(): Promise<IMemoryStore> {
  const cfg = config();
  if (cfg.memoryBackend === "sqlite") {
    try {
      return await SqliteMemoryStore.open(cfg.memorySqlitePath);
    } catch (err) {
      // Fallback path — keep going so the server stays up.
      // eslint-disable-next-line no-console
      console.warn(
        "[memory] sqlite backend unavailable, falling back to in-memory:",
        (err as Error).message,
      );
      return new MemoryStore();
    }
  }
  return new MemoryStore();
}
