# Ensemble — Test Protocol

Six-level taxonomy. All gates green = ready to tag.

## Automated gates (run on every change)

| Level | Command | Scope | SLO |
|---|---|---|---|
| L1–L4 root | `bun test` | server + shared + spi-conformance + integration | <90s, all green |
| L1 web | `bun --filter @ensemble/web test` | React component + api-client | <30s, all green |
| L5 E2E | `bun x playwright test` | Templates picker (Chromium); others scaffolded as `test.skip` pending UI alignment | <60s, ≥2 green |
| Typecheck | `bun run typecheck` | all 4 packages | clean |

```bash
bun install
bun run typecheck            # → clean across @ensemble/{shared,spi-conformance,server,web}
bun test                     # → root suites (server, shared, spi-conformance, L4 integration)
bun --filter @ensemble/web test
bun x playwright install chromium   # one-time
bun x playwright test
```

## L6 live smoke (nightly + pre-release)

Hits the real Anthropic API via `DirectSdkRuntime`. Gated by `ENSEMBLE_TEST_MODE=live`. Cost target: under ~$0.10/run on Haiku 4.5.

```bash
ENSEMBLE_TEST_MODE=live bun test apps/server/tests/live/managed-agents.live.test.ts
```

Asserts: two seats stream non-empty content; total wall <60s; the Con seat actually sees the Pro turn in its history.

## Pre-release manual checks

Work through these before tagging a new version. Tick each.

### Boot health

- [ ] `bun --filter @ensemble/server start` boots clean. `GET /health` reports `runtimes: ["managed-agents","human"]` (or `+["claude-code"]` with `CLAUDE_CODE_RUNTIME_ENABLED=true`) and `memory_backend: "SqliteMemoryStore"` by default.
- [ ] `bun --filter @ensemble/web dev` boots on :5173 with Vite HMR.
- [ ] `GET /mcp/tools` lists all 11 Host API tools.
- [ ] `GET /templates` returns the two presets (Debate, Roundtable).
- [ ] `GET /personas` returns the seeded library.

### Web flow (browser, manual)

- [ ] `/` renders the templates picker with paper aesthetic; both template cards visible.
- [ ] Click "Use Debate →" → `/casting?template=debate`.
- [ ] Casting screen enforces Debate's role constraint (Pro + Con required).
- [ ] Submit creates a session and navigates to `/session/:id`.
- [ ] Session screen subscribes to SSE; turn cards stream in; queue chips advance.
- [ ] Memory panel opens, accepts a write, reflects it after refresh.
- [ ] Moderator controls (with `?moderator=1`) fire force_speaker / cooldown / bypass / inject without error.

### Persona library

- [ ] Visit `/personas` — list shows seeded entries.
- [ ] Create a new persona, verify it shows in the list and persists across server restart (sqlite).
- [ ] Edit a persona, save, verify update.
- [ ] Delete a persona, verify removal.

### Live LLM smoke (real API)

- [ ] Run `ENSEMBLE_TEST_MODE=live bun test apps/server/tests/live/` — green, non-empty turns.
- [ ] Manually start a session in the browser against the live backend (`ANTHROPIC_API_KEY` set), small cast, 1 round. Watch the script populate in real time.

### Claude Code integration (v1.5 — manual only)

- [ ] With `CLAUDE_CODE_RUNTIME_ENABLED=true`, `GET /health` includes `claude-code`.
- [ ] Slash-command manifest at `apps/server/src/mcp/slash-command/manifest.json` validates as JSON.
- [ ] (Deferred to v1.5) `/ensemble cast <persona>` from inside Claude Code connects an agent to the session lobby.

## Known gaps documented for v1.1

- 4 of 6 Playwright specs are scaffolded as `test.skip()` against
  aspirational selectors that don't yet match the actual UI shape.
  Either refactor specs to match F+G's screens or add the missing
  affordances. Track in a v1.1 milestone.
- Claude Code runtime ships `MockMcpTransport`-only; `LocalCliTransport`
  is a stub. Real live wiring is v1.5.
- Persona library has no auth boundary; for v1 it's single-user / local.
- Session and memory CRUD endpoints likewise have no auth boundary.
