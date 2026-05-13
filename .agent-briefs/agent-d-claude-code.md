# Agent D — ClaudeCodeRuntime + slash command

**Branch:** `feat/runtime-claude-code`

You implement the runtime that lets a user join an Ensemble session as
one seat from their own running Claude Code session. The brief is a
sketch — full live integration is post-v1 — but you ship a real SPI
implementation that works against a `MockMcpTransport` in tests, with
a `LocalCliTransport` for local-only live testing.

## Scope (files you own)

- `apps/server/src/runtimes/claude-code/**` (new)
- `apps/server/src/mcp/slash-command/**` (new — manifest + README for `/ensemble cast`)

## Off-limits

- `packages/shared/**` (frozen)
- Other runtime directories
- `apps/server/src/scheduler/**`, `apps/server/src/mcp/index.ts` and tools (Agent B)
- `apps/server/src/runtimes/index.ts`
- `apps/web/**`

## What you build

### ClaudeCodeRuntime

`apps/server/src/runtimes/claude-code/index.ts` — class implementing `PersonaRuntime` (from `@ensemble/shared/spi`).

Default capabilities: `{ "streaming", "buzz_check", "tools", "mcp" }`.

Constructor takes an injected `ClaudeCodeTransport` (your interface), a `BuzzCoordinator`, and a config flag indicating whether the runtime is enabled.

Implementations:

- **`attach(persona, ctx)`** — over the transport, send a "session brief" containing the persona spec, scenario, cast, and the MCP URL+token from `ctx`. Wait for an acknowledgement. Return a handle with the session ID returned by the transport.

- **`takeTurn(handle, newEvents)`** — over the transport, send a "your turn" message formatted from `newEvents`. Yield streamed output chunks until the transport signals end-of-turn.

- **`buzzCheck(handle, recentTurns)`** — same nonce flow as Agent C: register a `BuzzCoordinator` waiter, send a buzz-check prompt over the transport, await resolution. If timeout, return `{score:0, intent:"", can_pass:true}`.

- **`detach(handle)`** — send a "session end" over the transport.

### ClaudeCodeTransport interface

`apps/server/src/runtimes/claude-code/transport.ts`:

```ts
export interface ClaudeCodeTransport {
  open(brief: SessionBrief): Promise<{ session_id: string }>;
  send(sessionId: string, message: ClaudeCodeMessage): AsyncIterable<string>;
  close(sessionId: string): Promise<void>;
}
```

(`SessionBrief` and `ClaudeCodeMessage` are local types; document them in the file.)

### Two transport implementations

1. **`MockMcpTransport`** (`apps/server/src/runtimes/claude-code/mock-transport.ts`) — in-memory, replays scripted text streams and scripted tool calls from a fixture file. This is what tests use.
2. **`LocalCliTransport`** (`apps/server/src/runtimes/claude-code/local-cli-transport.ts`) — spawns / connects to a real local Claude Code session via the appropriate mechanism. **This is the ONLY file that imports `child_process` / spawn / subprocess primitives.** A lint rule (or test) asserts this — see below.

### Lint rule / static check

Add a test `apps/server/src/runtimes/claude-code/no-cli-leakage.test.ts` that reads every `.ts` file under your scope and asserts that `child_process` (or any subprocess module) is only imported in `local-cli-transport.ts`. Hand-rolled is fine — just `fs.readdir` + `readFileSync` + regex.

### Slash command manifest

`apps/server/src/mcp/slash-command/manifest.json` — describes the `/ensemble cast <persona>` slash command for Claude Code. Fields: `name`, `description`, `arguments` (e.g., `[{ name: "persona", required: true }, { name: "session_url", required: false }]`). This is a static manifest; the actual command behavior is "connect Ensemble's MCP server with the supplied persona and join the session."

`apps/server/src/mcp/slash-command/README.md` — for users: how to install/use the slash command. ~300 words.

### Feature flag

The runtime registers itself only if `CLAUDE_CODE_RUNTIME_ENABLED=true` in config. Default OFF. With the flag off, attach throws a clean `RuntimeDisabledError("Claude Code runtime is not configured")`.

## Test obligations

- **L1:** `transport.test.ts` — the interface contract on `MockMcpTransport`: open/send/close basic shape.
- **L1:** `no-cli-leakage.test.ts` — asserts the import isolation invariant.
- **L2:** `conformance.test.ts` — calls `runConformanceSuite("claude-code", factory)` with a factory that wires `ClaudeCodeRuntime` to `MockMcpTransport` and fixtures.
- **Local-only (do NOT run in CI; gated by env var):** `tests/live/claude-code.live.test.ts` — drives a real local Claude Code session via `LocalCliTransport`. Document in HANDOFF.md how to run it.

If Agent A's spi-conformance suite isn't fully populated yet, the L2 test is best-effort. Document.

## HANDOFF.md must include

- Integration edit: `runtimes['claude-code'] = new ClaudeCodeRuntime(transport, buzzCoordinator, config)` — but **only register if `config.claudeCodeRuntimeEnabled`**. The orchestrator should add a conditional check.
- Env vars: `CLAUDE_CODE_RUNTIME_ENABLED` (default false).
- The slash command install / use story (link to your README).
- Note: this branch merges FIFTH.

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for your scope.
- `no-cli-leakage.test.ts` passes.
- L2 SPI conformance passes against `MockMcpTransport`.
- Slash command manifest validates as JSON.

## Pre-authorized fallback

If, while implementing, you discover that the necessary primitives to
actually wire to a live Claude Code session aren't accessible (e.g.,
there's no documented MCP-over-stdio path that fits, or the subprocess
boundary is too brittle to get right in this pass), ship the
**MockClaudeCodeRuntime** as the only implementation — gate it behind
`CLAUDE_CODE_RUNTIME_ENABLED=true` (default off), pass the conformance
suite against it, and document the gap in `HANDOFF.md`. The slash
command manifest still ships. The live path is a v1.5 deliverable.
