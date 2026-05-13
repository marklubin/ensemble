/**
 * MockMcpTransport — in-memory ClaudeCodeTransport for tests.
 *
 * Tests construct it with a `MockTransportFixture` that specifies how
 * to respond to attach (`open`) and to each kind of message (`send`).
 * No subprocesses, no network, no filesystem.
 *
 * Fixture authors can:
 *   - script the streamed chunks returned for a turn
 *   - script a buzz-check resolution (press or pass) — the transport
 *     calls the optional `onBuzzCheck` hook so the runtime/test can
 *     resolve the buzz waiter via the BuzzCoordinator while the stream
 *     drains
 *   - have `send` throw to simulate transport errors
 *
 * Anything fancier (tool-use loops, multi-message flows) is overkill
 * for L1/L2 — the SPI conformance suite exercises the *contract*, not
 * the agent loop.
 */

import type { ClaudeCodeTransport } from "./transport.ts";
import type { ClaudeCodeMessage, SessionBrief } from "./types.ts";

export interface MockTransportFixture {
  /**
   * How to respond to `open`. Default returns a deterministic id of the
   * form `mock-session-${seat_id}`. Throw to simulate an attach failure.
   */
  openResponse?: (brief: SessionBrief) => Promise<{ session_id: string }> | { session_id: string };

  /**
   * Streamed chunks to yield for a turn message. Receives the brief
   * (so fixtures can vary by persona) and the message. Default yields
   * a single chunk that quotes the prompt.
   */
  turnChunks?: (
    brief: SessionBrief,
    message: Extract<ClaudeCodeMessage, { kind: "turn" }>,
  ) => Iterable<string> | AsyncIterable<string>;

  /**
   * Streamed chunks to yield for a buzz-check message. Default yields
   * a small status string. Use `onBuzzCheck` to drive the actual
   * BuzzCoordinator resolution out of band.
   */
  buzzChunks?: (
    brief: SessionBrief,
    message: Extract<ClaudeCodeMessage, { kind: "buzz_check" }>,
  ) => Iterable<string> | AsyncIterable<string>;

  /**
   * Side-channel hook fired when the transport receives a buzz_check.
   * Tests use this to resolve the BuzzCoordinator with a scripted
   * `pressed` or `passed` resolution, simulating the agent calling the
   * `buzzer.*` MCP tools.
   */
  onBuzzCheck?: (
    brief: SessionBrief,
    message: Extract<ClaudeCodeMessage, { kind: "buzz_check" }>,
  ) => void | Promise<void>;
}

/** Minimal default fixture — useful in smoke tests. */
export const DEFAULT_FIXTURE: MockTransportFixture = {
  turnChunks: function* (_brief, message) {
    yield `mock-response: ${message.prompt.slice(0, 64)}`;
  },
  buzzChunks: function* () {
    yield "buzz-check ack";
  },
};

interface OpenSession {
  brief: SessionBrief;
}

export class MockMcpTransport implements ClaudeCodeTransport {
  private readonly sessions = new Map<string, OpenSession>();
  private readonly fixture: MockTransportFixture;

  constructor(fixture: MockTransportFixture = DEFAULT_FIXTURE) {
    this.fixture = fixture;
  }

  async open(brief: SessionBrief): Promise<{ session_id: string }> {
    const result = this.fixture.openResponse
      ? await this.fixture.openResponse(brief)
      : { session_id: `mock-session-${brief.seat_id}` };
    this.sessions.set(result.session_id, { brief });
    return result;
  }

  async *send(sessionId: string, message: ClaudeCodeMessage): AsyncIterable<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`MockMcpTransport: unknown session ${sessionId}`);
    }

    if (message.kind === "turn") {
      const fn = this.fixture.turnChunks ?? DEFAULT_FIXTURE.turnChunks!;
      yield* normalizeIterable(fn(session.brief, message));
      return;
    }

    // buzz_check
    if (this.fixture.onBuzzCheck) {
      // Fire and forget — the hook is expected to resolve the
      // BuzzCoordinator separately. Awaiting here would serialize the
      // stream behind the resolution.
      void Promise.resolve(this.fixture.onBuzzCheck(session.brief, message));
    }
    const fn = this.fixture.buzzChunks ?? DEFAULT_FIXTURE.buzzChunks!;
    yield* normalizeIterable(fn(session.brief, message));
  }

  async close(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /** Test helper: number of currently open sessions. */
  openCount(): number {
    return this.sessions.size;
  }
}

async function* normalizeIterable(
  iter: Iterable<string> | AsyncIterable<string>,
): AsyncIterable<string> {
  // Works for both sync and async iterables.
  for await (const chunk of iter as AsyncIterable<string>) {
    yield chunk;
  }
}
