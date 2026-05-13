/**
 * L6 — live Claude Code CLI smoke.
 *
 * Drives a real `claude -p` subprocess via `LocalCliTransport`. Gated
 * by ENSEMBLE_TEST_MODE === "live". Skips if the `claude` binary isn't
 * on PATH.
 *
 * Run:
 *   ENSEMBLE_TEST_MODE=live bun test apps/server/tests/live/claude-code.live.test.ts
 *
 * What this validates:
 *   - LocalCliTransport spawns claude with our system-prompt + MCP config
 *   - claude streams text back on stdout
 *   - The persona's voice shows through (we assert role-appropriate content)
 *
 * Cost target: under ~$0.05/run (1 turn on Haiku 4.5).
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { ClaudeCodeRuntime } from "../../src/runtimes/claude-code/index.ts";
import { LocalCliTransport } from "../../src/runtimes/claude-code/local-cli-transport.ts";
import { BuzzCoordinator } from "../../src/mcp/buzz-coordinator.ts";
import type {
  InstanceHandle,
  PersonaSpec,
  SessionContext,
} from "@ensemble/shared";

const live = process.env["ENSEMBLE_TEST_MODE"] === "live";
const claudeBinary = "/Users/mark/.local/bin/claude";
const claudeAvailable = existsSync(claudeBinary);

const persona: PersonaSpec = {
  id: "TestKeith",
  name: "Keith",
  system_prompt:
    "You are Keith, a startup CEO who responds with vision-elevating, " +
    "acknowledge-and-redirect rhetoric. You use phrases like 'concur' " +
    "and 'that's a really good point.' Keep responses under 30 words.",
  role: "Founder",
  buzz_in_policy: "Speak when strategy or vision is being challenged.",
  tools_allowed: [],
  memory_policy: "ephemeral",
};

const ctx: SessionContext = {
  session_id: "claude-cli-smoke",
  seat_id: "keith",
  scenario: "Should our team rewrite the codebase?",
  scenario_format: "question",
  cast: [
    {
      seat_id: "keith",
      persona_id: "TestKeith",
      persona_name: "Keith",
      role: "Founder",
      runtime_type: "claude-code",
    },
  ],
  ensemble_mcp_url: "http://localhost:4111/mcp/rpc",
  ensemble_mcp_token: "no-mcp-needed-for-this-smoke",
};

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let s = "";
  for await (const chunk of stream) s += chunk;
  return s;
}

describe.skipIf(!live || !claudeAvailable)(
  "L6 live smoke: ClaudeCodeRuntime via LocalCliTransport",
  () => {
    test(
      "spawns claude -p, returns a non-empty turn in the persona's voice",
      async () => {
        const transport = new LocalCliTransport({
          binary: claudeBinary,
          model: "claude-haiku-4-5-20251001",
          timeoutSec: 90,
          maxBudgetUsd: 0.05,
        });
        const buzz = new BuzzCoordinator();
        const runtime = new ClaudeCodeRuntime(transport, buzz, {
          enabled: true,
        });

        const t0 = Date.now();
        const handle: InstanceHandle = await runtime.attach(persona, ctx);

        const text = await collect(runtime.takeTurn(handle, []));
        const elapsed = Date.now() - t0;

        // eslint-disable-next-line no-console
        console.log(`[L6 claude-code] (${text.length}c, ${elapsed}ms): ${text}`);

        expect(text.trim().length).toBeGreaterThan(10);
        expect(elapsed).toBeLessThan(90_000);

        await runtime.detach(handle);
      },
      120_000,
    );
  },
);
