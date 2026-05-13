/**
 * ClaudeCodeTransport — the seam between the runtime and the actual
 * Claude Code session.
 *
 * Two implementations live alongside this file:
 *   - `MockMcpTransport` — in-memory fixture replay; used by tests
 *   - `LocalCliTransport` — talks to a real local Claude Code session
 *     (the ONLY file in this directory allowed to import subprocess
 *     primitives; enforced by `no-cli-leakage.test.ts`)
 *
 * Keeping subprocess concerns behind this interface means the runtime
 * itself is pure async TS and the conformance suite never spawns
 * anything.
 */

import type { ClaudeCodeMessage, SessionBrief } from "./types.ts";

export interface ClaudeCodeTransport {
  /**
   * Open a Claude Code session for this seat. The transport delivers
   * the persona brief, attaches the Ensemble MCP server, and waits for
   * an acknowledgement before resolving with a session ID.
   */
  open(brief: SessionBrief): Promise<{ session_id: string }>;

  /**
   * Send a message into an open session and yield the streamed text
   * chunks back. End-of-turn is signalled by the iterable completing.
   */
  send(sessionId: string, message: ClaudeCodeMessage): AsyncIterable<string>;

  /** Tear down the session. */
  close(sessionId: string): Promise<void>;
}
