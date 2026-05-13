/**
 * LocalCliTransport — drives a real, local Claude Code CLI session.
 *
 * **This is the ONLY file in `apps/server/src/runtimes/claude-code/`
 * allowed to import subprocess primitives.** The invariant is
 * enforced by `no-cli-leakage.test.ts`.
 *
 * Strategy: one `claude -p` subprocess per turn. Stateless across
 * turns (full context is rebuilt from `TurnEvent[]` each time). The
 * persona spec drives `--system-prompt`; an Ensemble MCP server is
 * attached via `--mcp-config` so the persona can call host tools
 * (buzzer, memory, cast.list, etc.) from inside its agent loop.
 *
 * Multi-turn state coherence comes from re-feeding the transcript on
 * every turn — same approach the OpenAI/Anthropic adapters use. When
 * the CLI ships a stable resumable session shape we can switch to
 * `--continue` / `--resume`.
 *
 * Output streaming: `--output-format text` with `--print` streams
 * stdout progressively, which we yield as chunks.
 */

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClaudeCodeTransport } from "./transport.ts";
import type { ClaudeCodeMessage, SessionBrief } from "./types.ts";
import { logger } from "../../logging/index.ts";

export interface LocalCliTransportOptions {
  /** Path to the `claude` CLI binary. Defaults to `claude` on $PATH. */
  binary?: string;
  /** Model alias to use (sonnet|opus|haiku, or full id). Default: haiku 4.5. */
  model?: string;
  /** Max wall-clock seconds for a single turn. Default: 60. */
  timeoutSec?: number;
  /** Max USD budget per turn (passed to --max-budget-usd). Default: 0.10. */
  maxBudgetUsd?: number;
  /** Working directory for the spawned CLI; defaults to a per-session temp dir. */
  cwd?: string;
}

interface SpawnedSession {
  brief: SessionBrief;
  mcpConfigPath: string;
  workDir: string;
  /** Background-running subprocess for this seat (only during an active turn). */
  child?: ChildProcessByStdio<null, Readable, Readable>;
}

export class LocalCliTransport implements ClaudeCodeTransport {
  private readonly options: LocalCliTransportOptions;
  private readonly sessions = new Map<string, SpawnedSession>();

  constructor(options: LocalCliTransportOptions = {}) {
    this.options = options;
  }

  async open(brief: SessionBrief): Promise<{ session_id: string }> {
    const id = `claude-cli-${brief.ensemble_session_id}-${brief.seat_id}-${Math.random().toString(36).slice(2, 8)}`;
    // Each session gets its own temp dir so concurrent seats don't
    // collide on the MCP config file or any CLI-created scratch.
    const workDir = await mkdtemp(join(tmpdir(), "ensemble-claude-"));

    // Build per-seat MCP config pointing at Ensemble. The token scopes
    // tool access to (session_id, seat_id) on the server side.
    const mcpConfig = {
      mcpServers: {
        ensemble: {
          type: "http" as const,
          url: brief.ensemble_mcp_url,
          headers: { Authorization: `Bearer ${brief.ensemble_mcp_token}` },
        },
      },
    };
    const mcpConfigPath = join(workDir, "mcp-config.json");
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");

    this.sessions.set(id, { brief, mcpConfigPath, workDir });
    return { session_id: id };
  }

  async *send(
    sessionId: string,
    message: ClaudeCodeMessage,
  ): AsyncIterable<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`LocalCliTransport: unknown session ${sessionId}`);
    }
    const { brief, mcpConfigPath, workDir } = session;
    const model = this.options.model ?? "claude-haiku-4-5-20251001";
    const binary = this.options.binary ?? "claude";
    const timeoutMs = (this.options.timeoutSec ?? 60) * 1000;
    const budget = this.options.maxBudgetUsd ?? 0.1;

    const systemPrompt = buildSystemPrompt(brief, message);

    const args = [
      "-p",
      message.prompt,
      "--system-prompt",
      systemPrompt,
      "--mcp-config",
      mcpConfigPath,
      "--no-session-persistence",
      "--model",
      model,
      "--output-format",
      "text",
      "--dangerously-skip-permissions",
      "--max-budget-usd",
      String(budget),
    ];

    const child = spawn(binary, args, {
      cwd: this.options.cwd ?? workDir,
      env: {
        ...process.env,
        // Force minimal-mode so Claude Code doesn't try to read user
        // CLAUDE.md, hook configs, etc. Keeps the seat hermetic.
        CLAUDE_CODE_SIMPLE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcessByStdio<null, Readable, Readable>;

    logger.info("local_cli.spawn", {
      session_id: sessionId,
      pid: child.pid,
      binary,
      model,
      kind: message.kind,
    });

    session.child = child;
    child.once("close", (code, signal) => {
      logger.info("local_cli.exit", {
        session_id: sessionId,
        pid: child.pid,
        code,
        signal,
      });
    });
    const onTimeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    try {
      const decoder = new TextDecoder();
      const stderrChunks: string[] = [];
      child.stderr.on("data", (chunk: Buffer) =>
        stderrChunks.push(decoder.decode(chunk)),
      );

      // Yield stdout chunks as they arrive.
      for await (const chunk of child.stdout) {
        const text = decoder.decode(chunk as Buffer);
        if (text.length > 0) yield text;
      }

      // Wait for the process to fully exit so we can check the code.
      const code = await new Promise<number | null>((resolve) =>
        child.once("close", (c) => resolve(c)),
      );
      if (code !== 0 && code !== null) {
        const stderr = stderrChunks.join("");
        throw new Error(
          `claude exited ${code}${stderr ? `: ${stderr.slice(0, 400)}` : ""}`,
        );
      }
    } finally {
      clearTimeout(onTimeout);
      session.child = undefined;
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.child?.kill();
    } catch {
      // already exited
    }
    try {
      await rm(session.workDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    this.sessions.delete(sessionId);
  }
}

/**
 * Compose the system prompt sent to `claude -p`. We blend the persona's
 * system prompt with light scaffolding that:
 *   - reminds the model it's playing a role in a multi-persona scene
 *   - lists the cast so cross-references make sense
 *   - notes the Host API tools available via the `ensemble.*` namespace
 */
function buildSystemPrompt(
  brief: SessionBrief,
  message: ClaudeCodeMessage,
): string {
  const cast = brief.cast
    .map((s) => `  - ${s.persona_name}${s.role ? ` (${s.role})` : ""}`)
    .join("\n");
  const buzzPolicy =
    brief.persona.buzz_in_policy ?? "Respond when you have something to add.";
  const tail =
    message.kind === "buzz_check"
      ? `\n\nThis is a BUZZ-CHECK. Decide if you want to speak next. ` +
        `Call the tool \`ensemble.buzzer.press({intensity, intent, nonce: "${message.nonce}"})\` ` +
        `if yes (intensity 0-10, intent one sentence), or ` +
        `\`ensemble.buzzer.pass({reason, nonce: "${message.nonce}"})\` if no. ` +
        `Do not produce free-form text — only call the tool.`
      : `\n\nIt is now your turn. Respond as ${brief.persona.name} in ` +
        `first person, in 1-3 short sentences. Stay in character.`;
  return (
    `${brief.persona.system_prompt}\n\n` +
    `## Scene\n${brief.scenario}\n\n` +
    `## Cast\n${cast}\n\n` +
    `## Buzz-in policy\n${buzzPolicy}\n` +
    `${tail}`
  );
}
