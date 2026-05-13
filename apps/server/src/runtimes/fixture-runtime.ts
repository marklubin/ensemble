/**
 * Fixture-backed `managed-agents` runtime, used by the E2E harness.
 *
 * When the server boots with `ENSEMBLE_TEST_MODE=fixture` and
 * `ENSEMBLE_E2E_FIXTURES=<path>`, the registry swaps the real
 * `DirectSdkRuntime` for a `RecordedRuntime` that plays back scripted
 * chunks from a JSON file.
 *
 * Fixture file shape:
 *   {
 *     "default": {           // bucket name (selectable via __reset)
 *       "pro": [
 *         ["Pro opens. "],   // first turn for pro
 *         ["Pro again. "]    // second turn for pro
 *       ],
 *       "con": [
 *         ["I disagree.\n"],
 *         ["Still no.\n"]
 *       ]
 *     },
 *     "start-error": { ... } // override for start-error.spec.ts
 *   }
 *
 * Keys are seat roles (case-insensitive) OR explicit seat_ids. The
 * runtime checks `ctx.role.toLowerCase()` first, then `ctx.seat_id`,
 * then falls through to `[seat-name] done.` boilerplate.
 *
 * The `current bucket` is process-global, switched by the test-only
 * `POST /sessions/__reset` endpoint with `{ fixture: "<bucket>" }`.
 * Default: "default".
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, dirname, join } from "node:path";
import type {
  Capability,
  InstanceHandle,
  PersonaRuntime,
  PersonaSpec,
  SessionContext,
  TurnEvent,
  BuzzResponse,
} from "@ensemble/shared";
import { RecordedRuntime } from "../scheduler/test-helpers/recorded-runtime.ts";

type FixtureBucket = Record<string, readonly (readonly string[])[]>;
type FixtureFile = Record<string, FixtureBucket>;

const DEFAULT_CAPS: ReadonlySet<Capability> = new Set([
  "streaming",
  "buzz_check",
  "tools",
  "mcp",
] as const);

const CHUNK_DELAY_MS = Number(process.env.E2E_CHUNK_DELAY_MS ?? 30);

let _fixtures: FixtureFile = { default: {} };
let _currentBucket = "default";

/**
 * Load fixture JSON. No-op if path is empty or file is missing — the
 * runtime falls through to `[seat] done.` placeholders, which is fine
 * for smoke tests that just want a non-empty stream.
 */
export function loadFixtures(path: string | undefined): void {
  if (!path) return;
  // Resolve relative paths against several anchors: cwd, the server
  // package, and the repo root. The server package's CWD is
  // apps/server/ when launched via workspace filter, so plain relative
  // paths like ./e2e/fixtures/default.json wouldn't find the file at
  // the repo root.
  const candidates: string[] = [];
  if (isAbsolute(path)) {
    candidates.push(path);
  } else {
    const fromCwd = resolve(process.cwd(), path);
    candidates.push(fromCwd);
    // Walk up from cwd looking for the e2e/ directory (cheap fallback).
    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      const candidate = join(dir, path);
      if (!candidates.includes(candidate)) candidates.push(candidate);
      dir = dirname(dir);
    }
  }

  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "fixture_file_missing",
        path,
        candidates,
      }),
    );
    return;
  }
  try {
    _fixtures = JSON.parse(readFileSync(found, "utf-8")) as FixtureFile;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        msg: "fixtures_loaded",
        path: found,
        buckets: Object.keys(_fixtures),
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        msg: "fixture_load_failed",
        path,
        error: (err as Error).message,
      }),
    );
  }
}

/** Switch the active bucket (called by POST /sessions/__reset). */
export function setActiveBucket(bucket: string): void {
  _currentBucket = bucket;
}

export function getActiveBucket(): string {
  return _currentBucket;
}

/**
 * Resolve which chunk-script to use for a given attach. Returns a
 * non-empty fallback so the scheduler never sees an empty turn.
 */
function scriptsFor(persona: PersonaSpec, ctx: SessionContext): readonly (readonly string[])[] {
  const bucket = _fixtures[_currentBucket] ?? _fixtures.default ?? {};
  const seat = ctx.cast.find((s) => s.seat_id === ctx.seat_id);
  const role = (seat?.role ?? "").toLowerCase();
  return (
    bucket[ctx.seat_id] ??
    bucket[role] ??
    bucket[persona.name?.toLowerCase() ?? ""] ??
    [[`(${persona.name}) speaks. `], [`(${persona.name}) responds. `]]
  );
}

/**
 * Build a configured RecordedRuntime instance. Each attach decides its
 * chunks from the active fixture bucket. We do this dynamically (per
 * attach) because the script depends on the persona role, which is
 * unknown until the session is being assembled.
 *
 * For SSE realism, we wrap RecordedRuntime so chunks are emitted with
 * a small inter-chunk delay (~30ms by default). Real Anthropic streams
 * arrive in flurries; we want UI rendering tests to match that vibe.
 */
class FixtureRuntime implements PersonaRuntime {
  readonly name = "managed-agents" as const;
  readonly defaultCapabilities = DEFAULT_CAPS;

  private readonly inner: Map<string, RecordedRuntime> = new Map();

  async attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    const scripts = scriptsFor(persona, ctx);
    const recorded = new RecordedRuntime({
      name: "managed-agents",
      capabilities: DEFAULT_CAPS,
      turnChunks: {
        [ctx.seat_id]: scripts,
      },
    });
    const handle = await recorded.attach(persona, ctx);
    this.inner.set(handle.id, recorded);
    return handle;
  }

  async *takeTurn(handle: InstanceHandle, newEvents: TurnEvent[]): AsyncIterable<string> {
    const recorded = this.inner.get(handle.id);
    if (!recorded) {
      throw new Error(`FixtureRuntime: unknown handle ${handle.id}`);
    }
    for await (const chunk of recorded.takeTurn(handle, newEvents)) {
      yield chunk;
      if (CHUNK_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
      }
    }
  }

  async buzzCheck(handle: InstanceHandle, recentTurns: TurnEvent[]): Promise<BuzzResponse> {
    const recorded = this.inner.get(handle.id);
    if (!recorded) return { score: 0, intent: "", can_pass: true };
    return recorded.buzzCheck(handle, recentTurns);
  }

  async detach(handle: InstanceHandle): Promise<void> {
    const recorded = this.inner.get(handle.id);
    if (recorded) {
      await recorded.detach(handle);
      this.inner.delete(handle.id);
    }
  }
}

export function createFixtureRuntime(): PersonaRuntime {
  return new FixtureRuntime();
}
