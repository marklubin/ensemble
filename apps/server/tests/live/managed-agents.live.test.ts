/**
 * L6 — live Anthropic API smoke.
 *
 * Gated by ENSEMBLE_TEST_MODE === "live". Hits the real Anthropic API
 * via DirectSdkRuntime (the production path while @anthropic-ai/sdk
 * doesn't yet expose beta.managedAgents).
 *
 * Run:
 *   ENSEMBLE_TEST_MODE=live bun test apps/server/tests/live/managed-agents.live.test.ts
 *
 * Cost target: under ~$0.10/run (2 short turns on Haiku 4.5).
 */

import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { DirectSdkRuntime } from "../../src/runtimes/managed-agents/direct-sdk-runtime.ts";
import type {
  InstanceHandle,
  PersonaSpec,
  SessionContext,
} from "@ensemble/shared";

const live = process.env["ENSEMBLE_TEST_MODE"] === "live";

const persona = (id: string, role: "Pro" | "Con"): PersonaSpec => ({
  id,
  name: id,
  system_prompt:
    `You are ${id}, taking the ${role} side of a brief two-line debate. ` +
    `Respond in one short sentence (max 25 words). Stay in character.`,
  role,
  tools_allowed: [],
  memory_policy: "ephemeral",
});

const makeCtx = (seat_id: string): SessionContext => ({
  session_id: "live-smoke",
  seat_id,
  scenario: "Pineapple belongs on pizza.",
  scenario_format: "motion",
  cast: [
    { seat_id: "pro", persona_id: "ProAlex", persona_name: "ProAlex", role: "Pro", runtime_type: "managed-agents" },
    { seat_id: "con", persona_id: "ConJordan", persona_name: "ConJordan", role: "Con", runtime_type: "managed-agents" },
  ],
  ensemble_mcp_url: "http://localhost:4111/mcp/rpc",
  ensemble_mcp_token: "live-smoke-no-mcp",
});

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let s = "";
  for await (const chunk of stream) s += chunk;
  return s;
}

describe.skipIf(!live)("L6 live smoke: DirectSdkRuntime against Anthropic", () => {
  test(
    "2-persona, 1-round debate: each seat returns a non-empty turn",
    async () => {
      const key = process.env["ANTHROPIC_API_KEY"];
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      const client = new Anthropic({ apiKey: key });
      // Haiku 4.5 — cheap, fast, fine for a smoke check.
      const runtime = new DirectSdkRuntime(
        client,
        "claude-haiku-4-5-20251001",
      );

      const proHandle: InstanceHandle = await runtime.attach(
        persona("ProAlex", "Pro"),
        makeCtx("pro"),
      );
      const conHandle: InstanceHandle = await runtime.attach(
        persona("ConJordan", "Con"),
        makeCtx("con"),
      );

      const ts = () => new Date().toISOString();
      const t0 = Date.now();

      const proText = await collect(
        runtime.takeTurn(proHandle, []),
      );
      expect(proText.trim().length).toBeGreaterThan(0);

      const conText = await collect(
        runtime.takeTurn(conHandle, [
          {
            kind: "turn",
            seat_id: "pro",
            speaker: "ProAlex",
            content: proText,
            round: 1,
            timestamp: ts(),
          },
        ]),
      );
      expect(conText.trim().length).toBeGreaterThan(0);

      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(60_000);

      // Make the round legible in the test output.
      // eslint-disable-next-line no-console
      console.log(`[L6] pro (${proText.length}c): ${proText}`);
      // eslint-disable-next-line no-console
      console.log(`[L6] con (${conText.length}c): ${conText}`);
      // eslint-disable-next-line no-console
      console.log(`[L6] total: ${elapsed}ms`);

      await runtime.detach(proHandle);
      await runtime.detach(conHandle);
    },
    90_000,
  );
});
