/**
 * Tiny structured-JSON logger.
 *
 * Why this exists.
 *   Fly's log pipeline indexes anything emitted on stdout. A small
 *   structured emitter — `console.log(JSON.stringify(entry))` — gives
 *   us per-line, machine-readable diagnostics without pulling in
 *   `pino`/`winston`. The brief explicitly forbids the heavier deps.
 *
 * Usage
 *   ```ts
 *   import { logger } from "../logging/index.ts";
 *   logger.info("session.created", { session_id, template_id });
 *   logger.error("attach_failed", { seat_id, error: err.message });
 *   ```
 *
 * Each entry shape:
 *   { ts: ISO-8601, level: "info" | ..., msg: string, ...fields }
 *
 * Secrets — DO NOT log:
 *   - ANTHROPIC_API_KEY, JWT_SECRET, raw MCP tokens
 *   - full Anthropic API responses (length + usage only)
 *   - raw persona prompts or transcript bodies (length is fine)
 *
 * Tests capture stdout via `console.log` interception; see
 * `index.test.ts`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [k: string]: unknown;
}

export function log(
  level: LogLevel,
  msg: string,
  fields: LogFields = {},
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  // Fly's log indexer reads anything on stdout. Single line JSON.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => log("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => log("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => log("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => log("error", msg, fields),
};

/**
 * Short uuid for request_id / similar correlation ids. Not RFC-4122;
 * just 16 hex chars from crypto.randomUUID. Enough entropy to avoid
 * collisions within a single Fly machine's request stream.
 */
export function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
