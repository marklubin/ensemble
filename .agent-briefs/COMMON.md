# Phase 1 — Common brief (read first)

You are one of seven coding agents implementing **Ensemble v1**, a
multi-persona scene-simulator. This document is shared context every
Phase 1 agent reads first; your role-specific brief sits alongside it.

## Product in one paragraph

A web app where you cast a few personas, pick a format (debate,
roundtable, …), set the scenario, and watch them play it out as a
streaming screenplay-style transcript. Each persona is a portable
spec; the runtime executing it is pluggable per-seat — the same
session can mix Anthropic Managed Agents, Claude Code, and a human.

## Stack (locked)

- TypeScript, Bun (`~/.bun/bin/bun`, v1.3.14), Zod
- Server: Hono on Bun, `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`
- Web: React 18, Vite, React Router
- Tests: `bun test` for L1-L4; Playwright for L5 E2E

Versions are pinned in the Phase 0 commit (`v1-foundation`). **Do not
`bun add` against pinned shared deps.** New deps specific to your work
are OK; surface them in `HANDOFF.md`.

## Read these before coding

In your worktree root:
- `architecture.md` — design source of truth (SPI + Host API)
- `runtime-interface.md` — runtime spec (the operations you implement)
- `dimensions.md` — session configuration space + turn-taking modes
- `CONTRIBUTING.md` — Phase 1 rules (concise)
- Your role-specific brief (`.agent-briefs/agent-<your-id>.md`)
- The plan: `/Users/mark/.claude/plans/wait-thsi-seems-liek-purrfect-cascade.md` (referenceable; agents work to the spec, not the plan, but read it for context)

## Hard rules

- **`packages/shared/` is FROZEN.** Do not add, edit, or remove files in
  it. If you need a new cross-cutting type, define it locally in your
  own directory and surface in `HANDOFF.md` for orchestrator promotion.
- **Stay inside your declared directories.** Do not edit files outside
  your scope — including other agents' directories, the runtime
  registry, or the React router.
- **`apps/server/src/runtimes/index.ts` is orchestrator-only.** Don't
  add your runtime there. Surface the one-line edit in `HANDOFF.md`.
- **`apps/web/src/App.tsx` router is orchestrator-only** beyond what
  Phase 0 placed. Add your screens under `apps/web/src/screens/<your>/`
  and surface route wiring in `HANDOFF.md`.

## Pre-declared shared contracts (Phase 0)

These already exist in `@ensemble/shared`. Import; do not duplicate:

- `PersonaSpec` (persona definition)
- `SessionContext` (handed to runtimes on attach)
- `SeatInfo`, `TurnTakingMode`, `ScenarioFormat`
- `TurnEvent` (discriminated: turn / moderator / scenario_change / cooldown)
- `BuzzResponse`
- `Capability` (enum), `InstanceHandle`, `PersonaRuntime` (the SPI)
- `HOST_API_TOOLS` (registry — 11 tools with Zod input schemas)
- `UiBridgeMessage` (server↔web wire protocol for human seat)
- `BuzzWaiterKey`, `BuzzWaiterResolution`, `BuzzCoordinator`
- `SseEvent` (discriminated union of UI events)
- `Template` (preset definition; Debate, Roundtable will use it)

Look in `packages/shared/src/` for the actual definitions.

## Test taxonomy (you implement the tests called out in your brief)

| Level | What | Tool | Where |
|---|---|---|---|
| L1 | unit (pure fns, schemas) | `bun test` | colocated `*.test.ts` |
| L2 | SPI conformance (runtimes only) | `bun test` via `@ensemble/spi-conformance` | runtime package test file |
| L3 | Host API contract (MCP server) | `bun test` + MCP SDK client | `apps/server/src/mcp/*.contract.test.ts` |
| L4 | integration (in-process wiring) | `bun test` | `apps/server/tests/integration/` |
| L5 | E2E (full UI + server) | Playwright | `e2e/` |
| L6 | live API smoke (nightly only) | `bun test --tag @live` | `apps/server/tests/live/` |

Default test mode: **fixture** (no live API calls). Tests that need
live API check `ENSEMBLE_TEST_MODE === "live"` and skip otherwise.

## HANDOFF.md (required at worktree root before merge)

```markdown
# HANDOFF — Agent <id> (<branch>)

## What works
- bullet list of features that are exercised and tested

## What's stubbed
- bullet list with file paths and TODO markers

## Env vars consumed
- list anything new that needs to land in apps/server/.env.example

## Integration edits required at Phase 2
- exact one-line edits the orchestrator needs to make
  (e.g. `runtimes['managed-agents'] = new ManagedAgentsRuntime(client)`)

## Types proposed for shared
- any types you defined locally that should promote to @ensemble/shared

## Tests delivered
- list of test files with one-line descriptions of each

## New dependencies added
- name + version + reason
```

## Stop-and-signal protocol

If you hit a blocker (API not accessible, schema change in shared truly
needed, irrecoverable type error in a sibling's interface):

1. **Stop.** Do not improvise into another agent's territory.
2. Write `BLOCKED.md` at your worktree root with:
   - What you were trying to do
   - The exact error
   - The smallest unblock — a stub, a feature flag, a fallback
3. Commit and exit.

## Pre-authorized fallbacks (no BLOCKED.md needed)

- **Managed Agents beta inaccessible (Agent C):** ship `DirectSdkRuntime`
  (plain `messages.create` + tool-use loop) under the same `managed-agents`
  registry name. SPI surface unchanged.
- **Claude Code can't wire to live CLI (Agent D):** ship the slash command
  manifest + `MockClaudeCodeRuntime` flagged off in config.
- **`bun:sqlite` issues (Agent B):** keep the in-memory store as default
  behind `MEMORY_BACKEND=in-memory` env var.

## Definition of done

Your worktree is ready to merge when:

1. `bun run typecheck` is clean across the workspace.
2. `bun test` for your package(s) is green in fixture mode.
3. The tests called out in your brief's "Test obligations" exist and pass.
4. `HANDOFF.md` is at the worktree root, complete.
5. Your work is committed on your branch.

If you can't get there, write `BLOCKED.md` and stop. Do not commit
broken or partial work without `BLOCKED.md`.
