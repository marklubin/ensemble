# v1 Integration Smoke — 2026-05-13

Phase 3 smoke validating the integrated v1 build after seven parallel
worktrees merged through B → A → E → C → D → F → G + the orchestrator
integration commit.

## What was exercised

### Automated (all green)

| Suite | Result |
|---|---|
| `bun run typecheck` (4 packages) | clean |
| `bun test` (server + shared + spi-conformance) | **320 pass / 0 fail** (672 expect) |
| `bun --filter @ensemble/web test` (web components + api-client) | **43 pass / 0 fail** (102 expect) |

### Manual smoke (verified live)

| Check | Result |
|---|---|
| `bun --filter @ensemble/server start` boots clean on :4111 | ✓ |
| `bun --filter @ensemble/web dev` boots Vite on :5173 with HMR | ✓ |
| `GET /health` returns `{"ok":true,"runtimes":["managed-agents","human"]}` | ✓ |
| `GET /health` with `CLAUDE_CODE_RUNTIME_ENABLED=true` adds `"claude-code"` | ✓ |
| `GET /mcp/tools` returns all 11 Host API tools | ✓ |
| `POST /sessions` with a 2-seat Debate cast validates and returns a `session_id` | ✓ |
| Web app at `/` (Vite proxy → server) serves shell HTML | ✓ |

### Required env at boot

- `ANTHROPIC_API_KEY` — required by config Zod schema; runtime lazily uses it.
- `JWT_SECRET` — must be ≥ 16 chars (Zod validation).
- `CLAUDE_CODE_RUNTIME_ENABLED` — optional, default off. When on, registers
  `claude-code` runtime backed by `MockMcpTransport` (live CLI wiring is v1.5).
- `MANAGED_AGENTS_MODE` — optional. Default `auto`. The pinned
  `@anthropic-ai/sdk@^0.32.1` doesn't expose `beta.managedAgents`, so
  auto-detect falls back to `DirectSdkRuntime` (regular `messages.create`
  with manual tool-use loop). Will flip to managed-agents mode when the
  SDK ships the beta surface.

## Integration bugs caught during the merge

Real cross-agent contract drift, fixed in orchestrator commits:

1. **SessionScheduler constructor signature mismatch** — Agent E wrote tests
   against the Phase 0 scheduler stub (5 positional args); Agent A's real
   scheduler takes a `SchedulerOptions` object. Fixed in
   `apps/server/tests/integration/human-seat-bridge.test.ts`.
2. **Bus subscribe callback return type** — `events.push(e)` returns
   `number`, breaking `void | Promise<void>` callback contract. Wrapped
   in a block.
3. **SPI conformance for HumanRuntime** — the suite expects `streaming`
   runtimes to yield ≥1 chunk. HumanRuntime requires external input via
   the UiBridge. Conformance factory now scripts a `chunk` + `submit`
   per `takeTurn` so the suite gets actual streamed content.
4. **happy-dom global preload broke server SSE** — F's root bunfig
   preload registered happy-dom globally, clobbering Node's native
   `Response`/`Request`, which Hono's SSE streaming relies on. Scoped
   the preload to `apps/web/bunfig.toml`; root `bun test` excludes
   `**/apps/web/**`; web tests run via `bun --filter @ensemble/web test`.
5. **`MockMcpTransport` not re-exported** — D's `index.ts` doesn't
   re-export the mock transport class. Registry imports it directly
   from `./claude-code/mock-transport.ts`.

## Outstanding (Phase 3 → v1.0.0)

These are required before tagging `v1.0.0` and exiting v1 scope. They
are documented for the next pass; not blocking the `v1-integrated`
milestone.

- **Live Managed Agents smoke (L6).** Requires a real `ANTHROPIC_API_KEY`
  in `apps/server/.env`. Run `bun test apps/server/tests/live/` with
  `ENSEMBLE_TEST_MODE=live`. Asserts 2-persona × 2-round transcript
  returns non-empty content per seat. Estimated cost <$1.
- **L5 E2E unskip.** Six Playwright specs exist as `test.skip()` pending
  this integration. Now that the screens and routes are wired, they can
  be unskipped. Requires:
  - A recorded SSE fixture for `active-session-render.spec.ts`
  - Memory CRUD HTTP endpoints (orchestrator surfaces these per G's
    HANDOFF: `GET/PUT/DELETE /sessions/:id/memory/:seat_id[/:key]`)
  - Moderator proxy endpoints (per G: `POST /sessions/:id/moderator/:tool`)
  - Test-only `/__diagnostics` endpoint with the contract G specified
- **Persona library persistence.** F's `api-client.ts` falls back to
  hardcoded mock fixtures when `GET /personas` returns 404. Server-side
  persona endpoints aren't yet implemented — F's HANDOFF leaves them as
  a follow-up. For v1.0.0, ship at least an in-memory persona store
  with the four expected routes (`list / get / save / delete`).
- **`bun:sqlite` memory store.** Currently default is in-memory per B's
  pre-authorized fallback. Decide whether to flip the default to
  `sqlite` for v1.0.0 or keep in-memory until v1.1.
- **Shared-type promotions from HANDOFFs.** Surfaced by agents:
  - `SessionLength` (Agent A) — moved already into `session/store.ts`;
    candidate for `@ensemble/shared` if the web client needs it.
  - `CreateSessionRequest` (Agent F + A) — both have a local version;
    promote to `@ensemble/shared` so the web client and server agree.
  - `SessionMeta`, `ModeratorAction` (Agent G) — needed by both UI and
    server proxy endpoints.
  - `nonce` as a first-class field on `BuzzerPress/PassInput` (Agent B
    workaround used a `#nonce:XXX` suffix in the `intent`/`reason`
    strings). Once promoted, drop the suffix transport.
- **TEST_PROTOCOL.md.** Document the manual checks for pre-release
  tagging (Claude Code `/ensemble cast` flow, live Managed Agents
  smoke, moderator features end-to-end, visual polish).

## Git state

- Branch: `main` at `aa22be3`
- Tags: `v1-foundation` (db82dbc), `v1-integrated` (aa22be3)
- Worktrees: still exist at `~/ensemble-agent-{a..g}/` — safe to remove
  with `git worktree remove --force` after archiving HANDOFFs.
- `handoffs/agent-{a..g}.md` preserved at repo root for audit.
