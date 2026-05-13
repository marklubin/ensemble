/**
 * In-memory ring buffer of recent log lines. Production uses Fly's
 * stdout log indexer; E2E tests dump this on failure so they have a
 * server-side view alongside the Playwright trace.
 *
 * Only enabled when `LOG_RING_BUFFER_SIZE` env var is set (Playwright
 * config sets it; production leaves it unset and pays zero overhead).
 */

export interface LogLine {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  [k: string]: unknown;
}

class RingBuffer {
  private readonly capacity: number;
  private readonly buf: LogLine[] = [];

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  push(line: LogLine): void {
    this.buf.push(line);
    if (this.buf.length > this.capacity) {
      this.buf.shift();
    }
  }

  /** Get lines whose ts > sinceIso (or all if undefined). */
  since(sinceIso: string | undefined): LogLine[] {
    if (!sinceIso) return [...this.buf];
    return this.buf.filter((l) => l.ts > sinceIso);
  }

  clear(): void {
    this.buf.length = 0;
  }

  get size(): number {
    return this.buf.length;
  }
}

const capacity = Number(process.env.LOG_RING_BUFFER_SIZE ?? 0);
let _instance: RingBuffer | null = capacity > 0 ? new RingBuffer(capacity) : null;

export function ringBufferEnabled(): boolean {
  return _instance !== null;
}

export function recordLog(line: LogLine): void {
  _instance?.push(line);
}

export function getLogsSince(ts: string | undefined): LogLine[] {
  return _instance?.since(ts) ?? [];
}

export function clearLogs(): void {
  _instance?.clear();
}

/** Test-only: reset with a new capacity. */
export function _resetForTests(capacity: number): void {
  _instance = capacity > 0 ? new RingBuffer(capacity) : null;
}
