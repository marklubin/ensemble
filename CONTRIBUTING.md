# Contributing — Phase 1 rules

Ensemble v1 is being implemented by a team of parallel coding subagents
in isolated git worktrees. These are the rules every agent operates
under during Phase 1.

## Workspace boundaries

- **`packages/shared/` is FROZEN during Phase 1.** Do not add, edit, or
  remove files in this package. All cross-agent contracts are
  pre-declared in `packages/shared/src/{ui-bridge,buzz-coordinator,sse,template}.ts`.
- **Other agents' directories are off-limits.** Each agent owns a
  specific subtree (see the plan). Stay inside yours.
- **`apps/server/src/runtimes/index.ts` is orchestrator-only.** Do not
  edit. The orchestrator wires registry entries during Phase 2
  integration; each runtime agent surfaces the exact one-line edit
  needed in its `HANDOFF.md`.
- **`apps/web/src/App.tsx` router** beyond what Bootstrap shipped is
  orchestrator-only. UX agents add their screens under
  `apps/web/src/screens/{their-screen}/` and surface the route wiring
  in their `HANDOFF.md`.

## New types

If you find yourself wanting to add a type to `packages/shared`,
**don't**. Instead:

1. Define it in your own directory (e.g. `apps/server/src/runtimes/managed-agents/types.ts`).
2. Note it in your `HANDOFF.md` under "Types proposed for shared".
3. The orchestrator promotes cross-cutting types during Phase 2.

## Dependencies

- Versions are pinned in Phase 0. **Do not run `bun add` against pinned
  shared deps** (`@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`,
  `hono`, `zod`, `react`, `vite`, `typescript`). Adding new deps
  specific to your agent's work is OK; surface the additions in your
  `HANDOFF.md`.

## Tests

You must deliver the tests called out in your brief's Testing Checklist.
Worktrees that don't pass the full test bar in fixture mode do not
merge. The bar:

- `bun run typecheck` clean across the workspace
- `bun test` for your package passes (L1 + L2 + L3 + L4 in fixture mode)
- Playwright L5 E2E passes if your work touches paths covered by `e2e/`

See `~/ensemble/architecture.md` and `~/ensemble/runtime-interface.md`
for the architectural source of truth, and the execution plan at
`~/.claude/plans/wait-thsi-seems-liek-purrfect-cascade.md` for the
phasing details.

## Stop and signal

If you hit a blocker that requires another agent's surface to change or
that requires shared-package edits during Phase 1, **stop and signal**.
Write a `BLOCKED.md` at your worktree root containing:

1. What you were trying to do.
2. The exact error or impossibility hit.
3. The smallest unblock you can see — a stub, a feature flag, a
   fallback approach.

Do NOT improvise into another agent's territory. The orchestrator
collapses the parallel phase to fix shared issues and re-fans-out.

## Pre-authorized fallbacks

These are pre-approved without needing to file a BLOCKED.md:

- **Managed Agents beta inaccessible (Phase 1C):** ship a
  `DirectSdkRuntime` (plain `messages.create` + tool-use loop) under
  the same `managed-agents` registry name. SPI surface unchanged.
- **Claude Code can't wire to live CLI (Phase 1D):** ship the slash
  command manifest + a `MockClaudeCodeRuntime` flagged off in config.
  Merge as-is.
- **`bun:sqlite` issues (Phase 1B):** keep the in-memory store as
  default behind `MEMORY_BACKEND=in-memory`; swap behind the env var
  is a follow-up.

## HANDOFF.md required at merge

Every worktree's root must contain a `HANDOFF.md` with:

- **What works** — features actually exercised and tested.
- **What's stubbed** — known TODOs with file paths.
- **Env vars consumed** — anything new that needs to land in `.env.example`.
- **Integration edits required** — exact one-line edits the
  orchestrator needs to make at integration (e.g.
  `runtimes['managed-agents'] = new ManagedAgentsRuntime(client)`).
- **Types proposed for shared** — if any.
- **Tests delivered** — list of test files, what each covers.
