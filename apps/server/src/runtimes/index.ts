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

// Claude Code (gated by env flag). v1.5: real `LocalCliTransport`
// (spawn `claude -p` per turn with Ensemble MCP config attached).
// Set CLAUDE_CODE_TRANSPORT=mock to fall back to the mock transport
// for tests / offline development.
if (process.env.CLAUDE_CODE_RUNTIME_ENABLED === "true") {
  const useMock = process.env.CLAUDE_CODE_TRANSPORT === "mock";
  const transport = useMock
    ? new MockMcpTransport()
    : new LocalCliTransport({
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
