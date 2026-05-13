# Agent C — ManagedAgentsRuntime

**Branch:** `feat/runtime-managed-agents`

You implement the SPI adapter that runs a persona inside an Anthropic
Managed Agents session, with `@anthropic-ai/sdk` as the client. This is
the primary runtime for v1.

## Scope (files you own)

- `apps/server/src/runtimes/managed-agents/**` (new)
- `packages/runtime-managed-agents/**` — optional; if you want the conformance test + fixtures in their own package, fine; otherwise put them under `apps/server/src/runtimes/managed-agents/`
- Fixtures at either location, your call: `packages/runtime-managed-agents/fixtures/*.jsonl` or `apps/server/src/runtimes/managed-agents/fixtures/`

## Off-limits

- `packages/shared/**` (frozen)
- Other runtime directories
- `apps/server/src/scheduler/**`, `apps/server/src/mcp/**`, `apps/server/src/memory/**`, `apps/server/src/auth/**`
- `apps/server/src/runtimes/index.ts`
- `apps/web/**`

## What you build

### ManagedAgentsRuntime

`apps/server/src/runtimes/managed-agents/index.ts` — class implementing
`PersonaRuntime` (from `@ensemble/shared/spi`).

Constructor takes an injected `Anthropic` client (so tests can pass
`FakeAnthropic`) and a `modelId`. Optionally takes a `BuzzCoordinator`
(from `@ensemble/shared/buzz-coordinator`) used for `buzzCheck`.

Default capabilities: `{ "streaming", "buzz_check", "tools", "mcp", "pause_resume" }`.

Implementations:

- **`attach(persona, ctx)`** — ensure an Agent definition exists in the Anthropic account (built from `persona.system_prompt`, `persona.tools_allowed`, the MCP URL+token from `ctx`). Cache by content hash so we don't recreate per session. Open a new Session against that Agent ID, registering Ensemble's MCP endpoint (`ctx.ensemble_mcp_url`, `ctx.ensemble_mcp_token`). Return `{ id: session.id, seat_id: ctx.seat_id, capabilities }`.

- **`takeTurn(handle, newEvents)`** — format `newEvents` into a user message via a `formatEventsAsTurnPrompt(newEvents)` helper (under `prompts.ts`); POST it as an event to the Session via the SDK with `stream: true`; yield text deltas as they arrive on the SSE stream.

- **`buzzCheck(handle, recentTurns)`** — generate a nonce (random string ≥8 chars); format a buzz-check prompt via `formatBuzzCheckPrompt(recentTurns, nonce)` instructing the agent to call `buzzer.press` or `buzzer.pass` (and include the nonce in the args); register a waiter with `BuzzCoordinator.wait({ session_id, seat_id, nonce }, timeout)`; send the prompt as a Session event; await the waiter's resolution; convert to `BuzzResponse` shape. If timeout, return `{ score: 0, intent: "", can_pass: true }`.

- **`detach(handle)`** — archive the Session.

- **`pause(handle)` / `resume(handle)`** — Sessions are idle-cheap by default; pause = no-op, resume = no-op (document this). Or use the SDK's pause/resume if available.

### Pre-authorized fallback (no BLOCKED.md needed)

If the Anthropic Managed Agents beta API is inaccessible (404, auth
errors, SDK doesn't expose it, whatever): ship a **DirectSdkRuntime**
in the same directory under the same `managed-agents` registry name.
SPI surface unchanged. Implementation: maintain conversation state in
memory keyed by `handle.id`; for `takeTurn`, call `messages.create`
with `stream: true` and a tool-use loop that calls Ensemble's MCP
endpoint for tool dispatch.

Either way, the runtime registers as `name: "managed-agents"`. The
fallback is gated by a config flag, default to "auto-detect" (try
managed-agents first; on failure, fall back).

### Prompts

`apps/server/src/runtimes/managed-agents/prompts.ts`:
- `formatEventsAsTurnPrompt(events: TurnEvent[]): string` — turns a list of `TurnEvent` (from `@ensemble/shared/events`) into a single user message. Convention: each `turn` event becomes "**\<speaker\>**: \<content\>"; moderator events get a distinctive header; scenario-change announces the new prompt. Tail: "It is now your turn to respond. Respond naturally in first person."
- `formatBuzzCheckPrompt(recentTurns, nonce, buzz_in_policy?): string` — instructs the agent: "Here are the last N turns. Score 0-10 how strongly you want to respond. Call `buzzer.press({intensity, intent, nonce: <nonce>})` or `buzzer.pass({reason, nonce: <nonce>})`. Your buzz-in policy: \<policy\>."

### FakeAnthropic + fixtures

For tests, `apps/server/src/runtimes/managed-agents/test-helpers/fake-anthropic.ts`:
- Implements the narrow surface area of `@anthropic-ai/sdk` your adapter uses (`beta.managedAgents.sessions.create`, `events.create`, `archive`).
- Reads fixtures from a directory keyed by `(test_name, call_index)`.
- Fixtures are JSONL — one JSON event per line.

Ship 2-3 simple fixtures sufficient to drive the L2 conformance suite.

## Test obligations

- **L1:** `prompts.test.ts` — `formatEventsAsTurnPrompt` and `formatBuzzCheckPrompt` produce expected shapes for various inputs.
- **L1:** Agent-definition cache test (`agent-definition.test.ts`) — two attaches with the same persona reuse the cached definition; different personas get distinct definitions.
- **L2:** `conformance.test.ts` — a 2-line file calling `runConformanceSuite("managed-agents", factory)` from `@ensemble/spi-conformance`. The factory returns a runtime backed by `FakeAnthropic` + fixtures. **Must pass all 25 conformance cases.**
- **L6 live (optional in your worktree; runs nightly):** `apps/server/tests/live/managed-agents.live.test.ts` — gated by `ENSEMBLE_TEST_MODE=live`. Runs a tiny 2-persona 2-round scenario against the real API; asserts non-empty content per seat.

If Agent A's spi-conformance package isn't fully populated yet, the conformance test will skeleton-pass; that's fine — when A's worktree merges first the cases get exercised. Document this in HANDOFF.md.

## HANDOFF.md must include

- Integration edit: the one-line registration: `runtimes['managed-agents'] = new ManagedAgentsRuntime(anthropicClient, modelId, buzzCoordinator)` in `apps/server/src/runtimes/index.ts`.
- Env vars: `ANTHROPIC_API_KEY` (required), maybe `MANAGED_AGENTS_MODE=auto|managed|direct` for the fallback flag.
- If you shipped the DirectSdkRuntime fallback, document why and what it does.
- Note: orchestrator merges this branch FOURTH (after B, A, E).

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for your scope.
- L2 SPI conformance suite passes (against FakeAnthropic).
- L1 prompt + cache tests pass.
- Fixtures committed.
