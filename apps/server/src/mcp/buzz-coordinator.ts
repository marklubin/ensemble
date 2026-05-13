import type {
  BuzzCoordinator as IBuzzCoordinator,
  BuzzWaiterKey,
  BuzzWaiterResolution,
} from "@ensemble/shared";

/**
 * In-process BuzzCoordinator. Runtimes call `wait()` to await a
 * buzz-check resolution keyed by (session, seat, nonce). The MCP
 * server's `buzzer.press` / `buzzer.pass` tool handlers call
 * `resolvePress` / `resolvePass` with the nonce echoed back by the
 * persona's agent.
 *
 * Why nonce: a single runtime may have multiple buzz-checks in flight
 * (parallel cast, racy retries); the nonce routes the response to the
 * correct waiter without ambiguity.
 */

interface Pending {
  resolve(value: BuzzWaiterResolution): void;
  timer: ReturnType<typeof setTimeout> | null;
}

function keyOf(k: { session_id: string; seat_id: string; nonce: string }) {
  return `${k.session_id}::${k.seat_id}::${k.nonce}`;
}

export class BuzzCoordinator implements IBuzzCoordinator {
  private readonly pending = new Map<string, Pending>();

  wait(key: BuzzWaiterKey, timeoutMs: number): Promise<BuzzWaiterResolution> {
    const k = keyOf(key);
    return new Promise<BuzzWaiterResolution>((resolve) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(k);
              resolve({ kind: "timeout" });
            }, timeoutMs)
          : null;
      this.pending.set(k, { resolve, timer });
    });
  }

  cancel(key: BuzzWaiterKey): void {
    const k = keyOf(key);
    const p = this.pending.get(k);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(k);
  }

  /** Returns true if a waiter was resolved. */
  resolvePress(
    key: BuzzWaiterKey,
    score: number,
    intent: string,
  ): boolean {
    return this.resolveInternal(key, {
      kind: "pressed",
      score,
      intent,
    });
  }

  /** Returns true if a waiter was resolved. */
  resolvePass(key: BuzzWaiterKey, reason?: string): boolean {
    return this.resolveInternal(
      key,
      reason === undefined ? { kind: "passed" } : { kind: "passed", reason },
    );
  }

  private resolveInternal(
    key: BuzzWaiterKey,
    resolution: BuzzWaiterResolution,
  ): boolean {
    const k = keyOf(key);
    const p = this.pending.get(k);
    if (!p) return false;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(k);
    p.resolve(resolution);
    return true;
  }

  /** Test helper: how many waiters are currently registered. */
  size(): number {
    return this.pending.size;
  }
}
