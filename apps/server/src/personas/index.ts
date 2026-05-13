import { config } from "../config/index.ts";
import { InMemoryPersonaStore } from "./store.ts";
import type { IPersonaStore } from "./store.ts";
import { SqlitePersonaStore } from "./sqlite-store.ts";
import { SEED_PERSONAS } from "./seed.ts";

export { InMemoryPersonaStore } from "./store.ts";
export type { IPersonaStore } from "./store.ts";
export { SqlitePersonaStore } from "./sqlite-store.ts";
export { SEED_PERSONAS } from "./seed.ts";

/**
 * Pick a persona store based on the same backend selection used for
 * memory. Falls back to in-memory if sqlite fails (consistent with
 * MemoryStore). Seeds default personas on first boot when empty.
 */
export async function createPersonaStore(): Promise<IPersonaStore> {
  const cfg = config();
  let store: IPersonaStore;
  if (cfg.memoryBackend === "sqlite") {
    try {
      store = await SqlitePersonaStore.open(cfg.memorySqlitePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[personas] sqlite backend unavailable, falling back to in-memory:",
        (err as Error).message,
      );
      store = new InMemoryPersonaStore();
    }
  } else {
    store = new InMemoryPersonaStore();
  }
  if (store.count() === 0) {
    for (const p of SEED_PERSONAS) store.put(p);
  }
  return store;
}
