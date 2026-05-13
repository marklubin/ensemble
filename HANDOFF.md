# HANDOFF — Agent C (feat/runtime-managed-agents)

## What works

- **`DirectSdkRuntime`** — plain `@anthropic-ai/sdk` `messages.create` + streaming. Implements the full `PersonaRuntime` SPI (attach / takeTurn / buzzCheck / detach / pause / resume) with in-memory conversation state keyed by `handle.id`.
- **`ManagedAgentsRuntime`** — structurally complete adapter against the Anthropic Managed Agents beta surface (`client.beta.managedAgents.sessions.{create,events.create,archive}`). The bundled SDK (`@anthropic-ai/sdk@0.32.1`) does **not** expose this surface, so this class is exercised via `FakeAnthropic({ enableManagedAgents: true })` in tests; in production the auto-detect factory falls back to `DirectSdkRuntime`. If/when the SDK ships managed agents, the same class will start working against the live API with no code changes.
- **`createManagedAgentsRuntime` factory** — auto-detects the SDK surface; honors `MANAGED_AGENTS_MODE=auto|managed|direct`. Both paths register under the same `"managed-agents"` registry name.
- **`AgentDefinitionCache`** — content-hash keyed; two attaches with the same persona share one definition, different personas get distinct ones. Tools-allowed order doesn't affect the hash.
- **Prompt formatters** — `formatEventsAsTurnPrompt` and `formatBuzzCheckPrompt` per the brief.
- **`FakeAnthropic`** — narrow fake covering both `messages.create` (default) and `beta.managedAgents.*` (opt-in via `enableManagedAgents: true`). Supports inline event arrays, JSONL fixtures, error injection, and mid-stream disconnect.
- **Buzz-check** — both paths (`DirectSdkRuntime`, `ManagedAgentsRuntime`) support two modes: with an injected `BuzzCoordinator` (resolves via MCP nonce echo) and without (parses inline `tool_use` from the stream — useful for fixture tests). Timeout → `{ score: 0, intent: "", can_pass: true }`.

## What's stubbed

- **Real MCP tool dispatch in `DirectSdkRuntime`** — the loop currently does a single `messages.create` per turn and yields text deltas. It does not yet feed `tool_use` blocks back to the model via `tool_result` → re-invoke `messages.create`. For v1 this is acceptable because Ensemble's tools (buzzer / memory / cast) are served through an external MCP server that the model talks to directly per the runtime-interface design; the `DirectSdkRuntime` only needs the tool-loop when the model uses `tool_use` blocks instead of MCP. TODO marker in `apps/server/src/runtimes/managed-agents/direct-sdk-runtime.ts` near `takeTurn`.
- **L6 live test** — not delivered in this worktree (brief calls it optional / nightly).
- **SPI conformance suite cases (25)** — owned by Agent A (`packages/spi-conformance`). Currently the suite entry point is a no-op, so our `conformance.test.ts` skeleton-passes. When A merges, the cases run against our `FakeAnthropic`-backed factory in `test-helpers/factory.ts` automatically.

## Env vars consumed

- `ANTHROPIC_API_KEY` — required at runtime by the real `Anthropic` client (not by tests).
- `MANAGED_AGENTS_MODE` — `auto` (default) | `managed` | `direct`. Selects between the managed-agents path and the direct-SDK fallback. `auto` probes the SDK surface at construction time; `managed` throws if the SDK can't satisfy it.

## Integration edits required at Phase 2

In `apps/server/src/runtimes/index.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createManagedAgentsRuntime } from "./managed-agents/index.ts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
runtimes["managed-agents"] = createManagedAgentsRuntime({
  client: anthropic,
  modelId: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
  buzzCoordinator, // from Agent B's MCP server
});
```

(or `new ManagedAgentsRuntime(...)` / `new DirectSdkRuntime(...)` directly if the orchestrator wants to skip the factory).

## Types proposed for shared

None. Everything new lives in `apps/server/src/runtimes/managed-agents/` and re-uses pre-declared shared types (`PersonaRuntime`, `PersonaSpec`, `SessionContext`, `TurnEvent`, `BuzzResponse`, `BuzzCoordinator`, `BuzzWaiterKey`, `BuzzWaiterResolution`).

## Tests delivered

- `prompts.test.ts` — L1, 7 cases. Formatters produce expected shapes for turn events, moderator events, scenario change, cooldown, buzz check with/without policy, empty inputs, nonce echo.
- `agent-definition.test.ts` — L1, 7 cases. Cache reuse for same persona, distinct entries for different personas, MCP URL participates in hash, tool order doesn't, stable hashing, system prompt assembly.
- `direct-sdk-runtime.test.ts` — L1/L4, 17 cases. Attach handle shape, idempotent detach, unknown-handle error, definition cache reuse, streaming yields text chunks, non-empty chunks, history is preserved across turns, early-break cleanup, mid-stream error propagation, buzzer.press parsing, buzzer.pass → score 0, missing tool call default, score clamping, BuzzCoordinator integration with min-8-char nonce, timeout handling, pause/resume no-ops.
- `managed-agents-runtime.test.ts` — L1/L4, 4 cases. `isAvailable` probe (false / true paths), attach + takeTurn + detach against FakeAnthropic.beta.managedAgents, definition caching.
- `index.test.ts` — L1, 4 cases. Auto-mode picks managed when beta is available, falls back to direct when absent; explicit modes honored; "managed" throws clearly when the surface is missing.
- `conformance.test.ts` — L2, 2-line driver. Calls `runConformanceSuite("managed-agents", makeFixtureFactory)`. Skeleton-passes against the current (empty) suite from Agent A; auto-exercises whatever cases A delivers without any further changes here.

Total: **39 tests passing, 83 assertions, 0 failures**.

## New dependencies added

None new. Added one workspace dev-dependency (`@ensemble/spi-conformance`) to `apps/server/package.json` so the conformance test can import the suite entry point.

## Why DirectSdkRuntime (and not pure ManagedAgentsRuntime)

The pinned `@anthropic-ai/sdk@0.32.1` does not expose `client.beta.managedAgents`. Both classes ship in the same registry slot — `auto` mode picks the right one. The brief's pre-authorized fallback covers exactly this case.
