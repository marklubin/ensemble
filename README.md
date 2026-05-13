# ensemble

A multi-persona scene simulator. You cast a few personas, pick a format
(debate, roundtable, ...), set the scenario, and watch them play it
out as a streaming scripted scene.

Baseline lineage:
- `~/synix-archive/archive/misc/tools/debate/` — Python + Textual TUI
- `~/Documents/simulate/sim.py` — stripped-down Kinelo roundtable

## Status

Phase 0 foundation. Workspace scaffolded; Zod schemas + SPI + Host API
tool registry stable. Phase 1 brings in 7 parallel agents implementing
the runtime adapters, scheduler, MCP server, and React UI.

## Layout

```
ensemble/
  apps/
    server/             Bun + Hono + scheduler + MCP server
    web/                React + Vite client
  packages/
    shared/             Zod schemas, SPI, Host API tool registry  (FROZEN in Phase 1)
    spi-conformance/    Test suite every runtime must pass        (L2)
  mockups/              Paper-aesthetic HTML baselines for the UX agents
  architecture.md       Design source of truth (read first)
  runtime-interface.md  SPI + Host API spec
  dimensions.md         Session configuration space
  CONTRIBUTING.md       Rules for Phase 1 agents
```

## Stack

- TypeScript, Bun, Zod
- Server: Hono + `@modelcontextprotocol/sdk` + `@anthropic-ai/sdk`
- Client: React 18 + Vite + React Router
- Tests: `bun test` + Playwright (L5 E2E)

## Concept

**Templates are starting configurations**, not different products. The
underlying engine is always: cast + scenario + turn-taking + streaming +
transcript. Templates pin specific values on most axes.

v1 ships two templates — Debate and Roundtable — and three runtimes:
Anthropic Managed Agents, Claude Code, and Human (via the web UI).

## Quickstart

```bash
bun install
bun run dev:server     # :4111
bun run dev:web        # :5173
```

## Reading order for a Phase 1 agent

1. `~/.claude/plans/wait-thsi-seems-liek-purrfect-cascade.md` — execution plan
2. `architecture.md` — SPI / Host API design
3. `runtime-interface.md` — runtime spec
4. `CONTRIBUTING.md` — Phase 1 rules
5. Your section of the plan
