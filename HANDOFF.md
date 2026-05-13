# HANDOFF — Agent D (`feat/runtime-claude-code`)

This branch merges **fifth** in the Phase 2 integration order.

## What works

- `ClaudeCodeRuntime` implements the full `PersonaRuntime` SPI
  (attach / takeTurn / buzzCheck / detach) and exposes the default
  capability set `{ streaming, buzz_check, tools, mcp }`.
- `ClaudeCodeTransport` interface with two implementations:
  - `MockMcpTransport` — in-memory, fixture-driven; what tests use.
  - `LocalCliTransport` — typed seam for the v1.5 live wiring; the
    only file in this directory allowed to import subprocess
    primitives. Today its `open` / `send` throw cleanly with a
    pointer to the slash-command README.
- Buzz-check flow: nonce-keyed `BuzzCoordinator` waiter is registered,
  buzz-check prompt is sent over the transport, runtime resolves
  `BuzzResponse` from `pressed` / `passed` / `timeout`.
- Feature flag: `attach` throws `RuntimeDisabledError("Claude Code
  runtime is not configured")` if the flag is off.
- Slash command manifest at
  `apps/server/src/mcp/slash-command/manifest.json` + README at
  `apps/server/src/mcp/slash-command/README.md`.
- Lint invariant: `no-cli-leakage.test.ts` greps every `.ts` file
  under `apps/server/src/runtimes/claude-code/` and asserts that only
  `local-cli-transport.ts` imports `child_process` /
  `node:child_process` / `Bun.spawn` / etc.

## What's stubbed

- `apps/server/src/runtimes/claude-code/local-cli-transport.ts` —
  `open` / `send` throw with a clear error message pointing to the
  v1.5 deliverable. The `spawn` import and `spawnChild` helper are
  real (the lint test asserts the file actually exercises subprocess
  primitives) but the path from `attach` to a live CLI is not wired.
  This is the pre-authorized fallback called out in COMMON.md.
- L2 conformance: passes against `MockMcpTransport` and the current
  `runConformanceSuite` (Phase 0 no-op skeleton). When Agent A fills
  in the 25 cases, the conformance test file already provides a
  factory that should satisfy them; if any case asserts an invariant
  we missed, the runtime will need a small follow-up.

## Env vars consumed

- `CLAUDE_CODE_RUNTIME_ENABLED` — `"true"` to register the runtime in
  the registry. Default off. Surface this in
  `apps/server/.env.example` at integration time.

## Integration edits required at Phase 2

In `apps/server/src/runtimes/index.ts`, conditional on the flag:

```ts
import { ClaudeCodeRuntime } from "./claude-code/index.ts";
import { MockMcpTransport } from "./claude-code/mock-transport.ts";
import { LocalCliTransport } from "./claude-code/local-cli-transport.ts";

if (process.env.CLAUDE_CODE_RUNTIME_ENABLED === "true") {
  // For v1, pair with MockMcpTransport — the live LocalCliTransport
  // throws on `open`. Swap to LocalCliTransport at v1.5.
  const transport = new MockMcpTransport();
  runtimes["claude-code"] = new ClaudeCodeRuntime(
    transport,
    buzzCoordinator,        // from Agent B's MCP server
    { enabled: true },
  );
}
```

`buzzCoordinator` is the instance Agent B's MCP server constructs and
registers as the `BuzzCoordinator` implementation. Until that wiring
lands, the runtime works against the stub coordinator in
`conformance.test.ts`.

## Types proposed for shared

None. All new types are internal seams:

- `SessionBrief` / `ClaudeCodeMessage` / `RuntimeDisabledError` /
  `ClaudeCodeRuntimeConfig` live in
  `apps/server/src/runtimes/claude-code/types.ts`.
- `ClaudeCodeTransport` lives in
  `apps/server/src/runtimes/claude-code/transport.ts`.

If a second runtime ends up wanting `RuntimeDisabledError`, promote
it then; one use isn't enough.

## Tests delivered

- `apps/server/src/runtimes/claude-code/transport.test.ts` — L1
  contract for `MockMcpTransport` (open/send/close shape, fixture
  replay, error on unknown session).
- `apps/server/src/runtimes/claude-code/no-cli-leakage.test.ts` —
  invariant test: only `local-cli-transport.ts` imports subprocess
  primitives, and that file actually uses them (no dead lint target).
- `apps/server/src/runtimes/claude-code/conformance.test.ts` — L2 SPI
  conformance entry point (`runConformanceSuite("claude-code", ...)`)
  plus local runtime contract tests (capabilities, feature-flag
  enforcement, takeTurn streaming, buzzCheck pressed / passed /
  timeout, idempotent detach, stale-handle error).
- `apps/server/src/mcp/slash-command/manifest.test.ts` — validates
  that `manifest.json` is well-formed JSON with the required fields
  (`name`, `arguments`, `mcp.tools`, etc.).

Local-only / live test placeholder: not authored. When the v1.5 CLI
wiring lands, drop a `tests/live/claude-code.live.test.ts` gated by
`ENSEMBLE_TEST_MODE === "live"` that drives a real session through
`LocalCliTransport`.

## New dependencies added

- Added `@ensemble/spi-conformance: workspace:*` to
  `apps/server/package.json`. No external deps.

## Slash command install / use

See `apps/server/src/mcp/slash-command/README.md`. Short version:
`/ensemble cast <persona> [session_url] [seat]` connects Ensemble's
per-session MCP server as one seat in a running Claude Code session.

## Acceptance gate snapshot

- `bun run typecheck` — clean across the workspace.
- `bun test` — 28 pass, 0 fail (across 4 files).
- `no-cli-leakage.test.ts` — green.
- L2 SPI conformance — passes against `MockMcpTransport` (against the
  Phase 0 skeleton suite; will need to be re-run once Agent A fills
  the cases).
- Slash command manifest — validated as JSON in `manifest.test.ts`.
- Live CLI path — **not wired**; pre-authorized fallback per COMMON.md.
