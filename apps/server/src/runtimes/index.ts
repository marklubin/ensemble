/**
 * Runtime registry. Wired at Phase 2 integration.
 *
 * The scheduler looks up runtimes by `seat.runtime_type`. To register
 * an additional runtime, add an entry to `runtimes` keyed by the
 * canonical name from the runtime's `name` property.
 *
 * For tests that need a clean registry, import `runtimes` and call
 * `Object.keys(runtimes).forEach(k => delete runtimes[k])` between
 * cases — or use the per-session override seam exported from
 * `apps/server/src/session/routes.ts`.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PersonaRuntime } from "@ensemble/shared";

import { config } from "../config/index.ts";
import { BuzzCoordinator, defaultMcpServerHost } from "../mcp/index.ts";
import { createManagedAgentsRuntime } from "./managed-agents/index.ts";
import { HumanRuntime } from "./human/index.ts";
import { UiBridge } from "../ui-bridge/index.ts";
import { ClaudeCodeRuntime } from "./claude-code/index.ts";
import { MockMcpTransport } from "./claude-code/mock-transport.ts";
import { LocalCliTransport } from "./claude-code/local-cli-transport.ts";
import { ChannelCoordinator } from "../channels/coordinator.ts";
import { ChannelRuntime } from "./channel/index.ts";

/** Shared UiBridge instance, mounted at `/ui-bridge` from the root server. */
export const uiBridge = new UiBridge();

/** Shared BuzzCoordinator instance the MCP server hands to runtimes. */
export const buzzCoordinator: BuzzCoordinator =
  defaultMcpServerHost().deps.buzz;

/** Anthropic client built lazily so tests that don't need it don't require an API key. */
let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: config().anthropicApiKey });
  }
  return _anthropic;
}

export const runtimes: Record<string, PersonaRuntime> = {};

// Managed Agents (always registered). Auto-detects between the beta
// API surface and the DirectSdkRuntime fallback per Agent C's design.
runtimes["managed-agents"] = createManagedAgentsRuntime({
  client: anthropic(),
  modelId: "claude-sonnet-4-6",
  buzzCoordinator,
});

// Human seat (always registered). UiBridge routes are mounted in apps/server/src/index.ts.
runtimes["human"] = new HumanRuntime(uiBridge);

/**
 * Shared ChannelCoordinator. Created lazily on first use so test suites
 * that don't enable channels never instantiate it. The WS upgrade
 * route in apps/server/src/index.ts pulls this same instance.
 */
let _channelCoordinator: ChannelCoordinator | null = null;
export function channelCoordinator(): ChannelCoordinator {
  if (!_channelCoordinator) {
    _channelCoordinator = new ChannelCoordinator();
  }
  return _channelCoordinator;
}

/**
 * Claude Code runtime — gated by env flag. Transport options:
 *   - `channel` (DEFAULT) — externally-managed Claude Code session
 *     attaches via the channel bridge. See apps/channel-bridge.
 *   - `cli` — legacy: spawn `claude -p` per turn (LocalCliTransport).
 *   - `mock` — in-process MockMcpTransport for tests / offline dev.
 */
if (process.env.CLAUDE_CODE_RUNTIME_ENABLED === "true") {
  const mode =
    (process.env.CLAUDE_CODE_TRANSPORT as
      | "channel"
      | "cli"
      | "mock"
      | undefined) ?? "channel";

  if (mode === "channel") {
    runtimes["claude-code"] = new ChannelRuntime(
      channelCoordinator(),
      buzzCoordinator,
      {
        enabled: true,
        turnTimeoutMs: Number(process.env.CLAUDE_CODE_TIMEOUT_SEC ?? 60) * 1000,
        attachConnectWaitMs: Number(
          process.env.CLAUDE_CODE_CHANNEL_CONNECT_WAIT_MS ?? 30_000,
        ),
      },
    );
  } else if (mode === "mock") {
    runtimes["claude-code"] = new ClaudeCodeRuntime(
      new MockMcpTransport(),
      buzzCoordinator,
      { enabled: true },
    );
  } else {
    // "cli"
    const transport = new LocalCliTransport({
      binary: process.env.CLAUDE_BINARY ?? "claude",
      model:
        process.env.CLAUDE_CODE_MODEL ?? "claude-haiku-4-5-20251001",
      timeoutSec: Number(process.env.CLAUDE_CODE_TIMEOUT_SEC ?? 60),
      maxBudgetUsd: Number(process.env.CLAUDE_CODE_MAX_BUDGET_USD ?? 0.1),
    });
    runtimes["claude-code"] = new ClaudeCodeRuntime(transport, buzzCoordinator, {
      enabled: true,
    });
  }
}
