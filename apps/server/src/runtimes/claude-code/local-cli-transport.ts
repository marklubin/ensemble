/**
 * LocalCliTransport — drives a real, local Claude Code CLI session.
 *
 * **This is the ONLY file in `apps/server/src/runtimes/claude-code/`
 * allowed to import `child_process`, `node:child_process`, `bun`'s
 * `Bun.spawn`, or any other subprocess primitive.** The invariant is
 * enforced by `no-cli-leakage.test.ts`. If you need a new transport,
 * either keep it pure or put its subprocess code here.
 *
 * Status (v1): SKETCH. The Claude Code CLI does not yet expose a
 * stable, scriptable headless mode suitable for SPI-driven turn
 * exchanges. The runtime ships under a feature flag (off by default)
 * and `MockMcpTransport` is the supported path. This class exists so:
 *
 *   1. The subprocess seam is real, and the lint rule has a real file
 *      to point at.
 *   2. When the CLI surface stabilises (post-v1), the wiring lives in
 *      one place and the rest of the runtime doesn't change.
 *
 * Until then `open` throws a clear error telling the caller to use
 * `MockMcpTransport` or to write `BLOCKED.md`.
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { ClaudeCodeTransport } from "./transport.ts";
import type { ClaudeCodeMessage, SessionBrief } from "./types.ts";

export interface LocalCliTransportOptions {
  /** Path to the `claude` CLI binary. Defaults to `claude` on $PATH. */
  binary?: string;
  /** Extra args to pass after the subcommand (e.g. `["--print", "--output-format=stream-json"]`). */
  args?: string[];
  /** Working directory for the spawned CLI; defaults to process.cwd(). */
  cwd?: string;
  /** Environment overlay for the spawned CLI. */
  env?: Record<string, string>;
}

interface SpawnedSession {
  /** Live child process for this seat. */
  child: ChildProcessWithoutNullStreams;
}

export class LocalCliTransport implements ClaudeCodeTransport {
  private readonly options: LocalCliTransportOptions;
  private readonly sessions = new Map<string, SpawnedSession>();

  constructor(options: LocalCliTransportOptions = {}) {
    this.options = options;
  }

  async open(_brief: SessionBrief): Promise<{ session_id: string }> {
    // The live wiring is intentionally not implemented in v1; see file
    // header. We still touch `spawn` (in `spawnChild`, below) so the
    // import isn't dead code, but the production path throws cleanly.
    throw new Error(
      "LocalCliTransport: live wiring is a v1.5 deliverable. " +
        "Use MockMcpTransport for tests and gate the runtime behind " +
        "CLAUDE_CODE_RUNTIME_ENABLED. See apps/server/src/mcp/slash-command/README.md.",
    );
  }

  async *send(_sessionId: string, _message: ClaudeCodeMessage): AsyncIterable<string> {
    throw new Error("LocalCliTransport: live wiring is a v1.5 deliverable.");
    // Unreachable but keeps the function an async generator.
    yield "";
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.child.kill();
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Reserved for the v1.5 wiring. Encapsulates the only call to
   * `spawn` in the codebase. Not invoked by `open` yet — keeping the
   * subprocess seam concrete and honest while we wait for a stable
   * scriptable CLI surface.
   */
  protected spawnChild(args: string[]): ChildProcessWithoutNullStreams {
    const binary = this.options.binary ?? "claude";
    return spawn(binary, [...args, ...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
  }
}
