# ensemble

> A multi-persona scene simulator. You cast a few personas, hand them a
> scenario, and watch them play it out as a streaming screenplay-style
> transcript. Each seat's runtime is pluggable — the same session can
> mix Anthropic, a real Claude Code subprocess, and a human at the
> keyboard.

**Design site:** [`marklubin.github.io/ensemble`](https://marklubin.github.io/ensemble/) — architecture, dimensions, runtime spec, and the paper-aesthetic mockups.

## Quickstart

```bash
bun install
cp apps/server/.env.example apps/server/.env   # add ANTHROPIC_API_KEY
bun run dev:server   # :4111  (Hono + MCP + scheduler)
bun run dev:web      # :5173  (React + Vite)
```

Open <http://localhost:5173>, pick a template, cast personas, start a session.

## How it's put together

Two interfaces, opposite directions, both thin:

- **SPI** — what runtimes implement so Ensemble can call into them.
  Four operations (`attach`, `takeTurn`, `buzzCheck`, `detach`) plus a
  capability set. The runtime owns the chat loop, tool dispatch,
  streaming, and conversation state. Ensemble doesn't reimplement any
  of that.

- **Host API** — what Ensemble exposes back, served as MCP tools on a
  per-session endpoint. The persona's agent calls these like any other
  tool: `buzzer.press`, `memory.read/write/list`, `cast.list`,
  `round.info`, plus moderator-only `force_speaker / cooldown / bypass / inject`.

See **[`docs/architecture.html`](docs/architecture.html)** for the full
reference. Read [`docs/runtime-interface.html`](docs/runtime-interface.html)
for the spec (Zod schemas + TypeScript interface + worked examples).
[`docs/dimensions.html`](docs/dimensions.html) lays out the session
configuration space.

## Runtimes (v1.5)

| Runtime | Status | Notes |
|---|---|---|
| `managed-agents` | Production | Auto-detects between Anthropic's beta Managed Agents API and `DirectSdkRuntime` (plain `messages.create` + tool-use loop). |
| `human` | Production | Web-UI bridge. Characters stream live as the human types; other personas see them in real time. |
| `claude-code` | Production (v1.5) | `LocalCliTransport` spawns `claude -p` per turn with the persona's system prompt + Ensemble's MCP attached via `--mcp-config`. Set `CLAUDE_CODE_RUNTIME_ENABLED=true`. |

Adding a runtime is a small adapter (~150 LOC) that implements the four
SPI operations against whatever backend you want — local Ollama, a
LangGraph agent, an OpenAI Assistant. The scheduler doesn't change.

## Stack

- **Language**: TypeScript
- **Runtime**: Bun
- **Validation**: Zod everywhere
- **Server**: Hono, `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`
- **Client**: React 18 + Vite + React Router
- **Tests**: `bun test` (L1–L4), Playwright (L5 E2E), `@live`-tagged smoke against the real Anthropic API and the real `claude` CLI (L6)

## Layout

```
ensemble/
├── apps/
│   ├── server/        Bun + Hono server (scheduler, MCP, runtimes)
│   └── web/           React + Vite client
├── packages/
│   ├── shared/        Zod schemas + SPI + Host API tool registry
│   └── spi-conformance/  25-case suite every runtime passes
├── docs/              Design site (architecture, dimensions, spec, mockups)
├── e2e/               Playwright specs
├── handoffs/          Per-agent handoff notes from the parallel build
├── architecture.md    Design source of truth
├── dimensions.md      Session configuration space
├── runtime-interface.md   SPI + Host API spec
└── TEST_PROTOCOL.md   Pre-release manual checks
```

## Tests

```bash
bun run typecheck                       # all four packages
bun test                                # server + shared + spi-conformance
bun --filter @ensemble/web test         # web component + api-client
bun x playwright install chromium       # one-time
bun x playwright test                   # L5 E2E

# Live API smoke (real Anthropic, real Claude Code)
ENSEMBLE_TEST_MODE=live bun test apps/server/tests/live/
```

## How it was built

This codebase was implemented as a parallel-agent build:

- Phase 0: foundation scaffold (this conversation, sequentially)
- Phase 1: 7 coding subagents in isolated git worktrees, each owning a
  strict subtree, against pre-declared shared contracts
- Phase 2: orchestrator-led merging in dependency order, with per-merge
  test gates that caught 5 cross-agent contract drifts
- Phase 3-5: a completion agent + main-thread finishing for v1.0 and v1.5

The per-agent briefs live in [`.agent-briefs/`](.agent-briefs/) and the
post-merge handoffs in [`handoffs/`](handoffs/). The full execution
log is the design site's docs + the git history.

## License

MIT — see [`LICENSE`](LICENSE).
