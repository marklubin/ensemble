/**
 * Bounded async queue backing a single seat-turn's inbound message stream.
 *
 * Producer (HTTP route) calls `push(msg)`; consumer (HumanRuntime.takeTurn)
 * iterates via `[Symbol.asyncIterator]`. Closing the queue ends iteration
 * cleanly. The iterator is *single-consumer* — only one HumanRuntime turn
 * may consume at a time.
 *
 * Buffering: messages pushed before a consumer attaches are buffered. The
 * consumer drains the buffer on first iteration.
 */
import type { UiBridgeMessage } from "@ensemble/shared";

export class AsyncMessageQueue implements AsyncIterable<UiBridgeMessage> {
  private buffer: UiBridgeMessage[] = [];
  private waiters: Array<(v: IteratorResult<UiBridgeMessage>) => void> = [];
  private closed = false;
  private cancelled = false;
  private cancelReason: string | undefined;

  push(msg: UiBridgeMessage): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: msg, done: false });
    } else {
      this.buffer.push(msg);
    }
  }

  /** Mark the queue as cancelled and close — consumers see done with reason. */
  cancel(reason?: string): void {
    this.cancelled = true;
    this.cancelReason = reason;
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: undefined, done: true });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get wasCancelled(): boolean {
    return this.cancelled;
  }

  get cancellationReason(): string | undefined {
    return this.cancelReason;
  }

  [Symbol.asyncIterator](): AsyncIterator<UiBridgeMessage> {
    return {
      next: (): Promise<IteratorResult<UiBridgeMessage>> => {
        if (this.buffer.length > 0) {
          const value = this.buffer.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<UiBridgeMessage>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
