# Agent B — MCP server, Auth, Memory

**Branch:** `feat/mcp-auth-memory`

You implement the MCP server that exposes Ensemble's Host API tools to
runtimes, the JWT-based token system that scopes access per
`(session, seat)`, and the durable memory store.

## Scope (files you own)

- `apps/server/src/mcp/**` (currently a stub returning 501; replace fully)
- `apps/server/src/memory/**` (in-memory exists; add a sqlite implementation behind the same interface)
- `apps/server/src/auth/**` (new directory)
- `apps/server/src/config/**` (new directory)
- `docs/adr/0001-mcp-and-auth.md` (new — short ADR documenting the choices you make)

Test files colocated.

## Off-limits

- `packages/shared/**` (frozen)
- `apps/server/src/runtimes/**`
- `apps/server/src/scheduler/**`, `apps/server/src/session/**` (Agent A)
- `apps/server/src/runtimes/index.ts`
- `apps/web/**`

## What you build

### MCP server (the Host API)

Replace `apps/server/src/mcp/index.ts` with a real MCP server using
`@modelcontextprotocol/sdk` over HTTP transport. The server is
**per-session** — when a session starts, the scheduler asks you for an
MCP URL and token for each seat, and you mint a scoped token.

Implement handlers for all tools in `HOST_API_TOOLS` (from
`@ensemble/shared/api`):

- `buzzer.press(intensity, intent)` — resolves a pending buzz waiter (see BuzzCoordinator below)
- `buzzer.pass(reason?)` — same, but the waiter resolves as `{kind: "passed"}`
- `memory.read(key)`, `memory.write(key, value)`, `memory.list()` — delegated to the MemoryStore, namespaced by `(session_id, seat_id)`
- `cast.list()` — returns the SeatInfo[] for the session
- `round.info()` — returns `{ round, mode, cooldown_remaining }`
- `moderator.force_speaker(seat_id)`, `moderator.cooldown(seat_id, rounds, reason)`, `moderator.bypass(seat_id, reason)`, `moderator.inject()` — **gated by the `moderator` claim in the token.** Server-side validation rejects any of these called without the claim.

Each handler's input is validated by the Zod schema declared in `HOST_API_TOOLS`. Responses should be Zod-shaped — define response schemas locally and document them in your ADR.

Subscribe to the EventBus (from Agent A's `apps/server/src/scheduler/event-bus.ts`) so that `moderator.*` handlers can affect scheduler state. In tests, you'll need a small fake EventBus until A's code is merged — that's expected. Use a local stub for testing your handlers.

### Auth

`apps/server/src/auth/jwt.ts`:
- `issue(payload: { session_id, seat_id, claims: string[] }, secret) → string`
- `verify(token, secret) → { session_id, seat_id, claims: string[] }`

`apps/server/src/auth/middleware.ts`:
- Hono middleware that extracts `Authorization: Bearer <token>`, verifies, attaches the parsed claims to `c.var.auth`.
- A second middleware factory `requireClaim("moderator")` that 403s if the claim is missing.
- A third one `requireSeatMatch(paramName: string)` that 403s if the token's `seat_id` doesn't match the path param (e.g., `:seat_id`).

Use `JWT_SECRET` from env. Define a clean error envelope: `{ error: "FORBIDDEN" | "INVALID_TOKEN", message: string }`.

### Memory

The existing `apps/server/src/memory/store.ts` is in-memory. Keep it as the default. Add `apps/server/src/memory/sqlite-store.ts` implementing the same interface using `bun:sqlite`. Select between them based on `MEMORY_BACKEND` env var (`in-memory` | `sqlite`). If `bun:sqlite` proves problematic, fall back to in-memory per the pre-authorized fallback.

Schema for sqlite: one table `memory_entries (session_id TEXT, seat_id TEXT, key TEXT, value TEXT, PRIMARY KEY (session_id, seat_id, key))`. Values stored as JSON strings.

### BuzzCoordinator

Implement `apps/server/src/mcp/buzz-coordinator.ts` per the
`BuzzCoordinator` interface in `@ensemble/shared/buzz-coordinator`.

- `wait(key, timeoutMs)` registers a promise keyed by `(session_id, seat_id, nonce)`.
- When a `buzzer.press` or `buzzer.pass` tool call arrives at the MCP server, parse the nonce from the tool call args (define a `nonce` arg on the tool inputs — propose this as an extension via HANDOFF.md if needed; for now, encode the nonce in the `intent` string or in a separate `nonce` field that the runtime's prompt asks the agent to include) and resolve the matching waiter.
- `cancel(key)` removes a pending waiter.

Export this from `apps/server/src/mcp/buzz-coordinator.ts` so Agent C (and any other runtime needing buzz checks) can import it.

### Config

`apps/server/src/config/index.ts`:
- Load and validate env vars with Zod.
- Export a typed `config` singleton: `{ port, anthropicApiKey, mcpPublicUrl, jwtSecret, memoryBackend, testMode }`.

### ADR

`docs/adr/0001-mcp-and-auth.md` — short (300-500 words) ADR documenting:
- Why JWT for scoped tokens (vs. session cookies, opaque API keys)
- How moderator claim works
- How buzzer nonce flow works
- Why sqlite for memory persistence

## Test obligations

- **L1:** `apps/server/src/auth/jwt.test.ts` — sign + verify round-trip; tampered token rejected; expired token rejected; missing claim rejected.
- **L1:** `apps/server/src/memory/store.test.ts` and `sqlite-store.test.ts` — read/write/list; namespacing by `(session, seat)` (writes in one namespace don't affect another).
- **L1:** `apps/server/src/mcp/buzz-coordinator.test.ts` — concurrent waiters resolved by correct nonce; timeout returns `{kind:"timeout"}`; cancel removes waiter.
- **L3 contract:** `apps/server/src/mcp/contract.test.ts` (or split per tool) — for each tool: happy path returns expected shape, invalid input rejected with structured error, moderator tools require `moderator` claim (FORBIDDEN without), cross-seat memory access blocked. Use the MCP SDK's in-process transport to construct a test client.
- **L4 integration:** `apps/server/tests/integration/moderator-privilege-gate.test.ts` — two MCP clients with different tokens; moderator's `force_speaker` succeeds; non-moderator's identical call gets FORBIDDEN; assert no side effects.
- **L4 integration:** `apps/server/tests/integration/mcp-memory-roundtrip.test.ts` — through the MCP server, call `memory.write({key:"x", value:42})` then `memory.read({key:"x"})`; assert 42 returned and persisted in store.

## HANDOFF.md must include

- Integration edits: minimal — the scheduler integration (Agent A's branch) needs to subscribe Agent B's MCP server to the EventBus and pass the BuzzCoordinator to runtimes. Document the exact wiring lines.
- Env vars consumed: `JWT_SECRET`, `MCP_PUBLIC_URL`, `MEMORY_BACKEND`, plus whatever else you add.
- Surface API: how runtimes get an MCP URL + scoped token for a seat. Suggest: a `mintSessionToken(session_id, seat_id, claims)` function and a `getSessionMcpUrl(session_id)` function exported from `apps/server/src/mcp/`.
- Note for orchestrator: this branch is merged FIRST.

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for `apps/server`.
- L3 contract tests cover all 11 tools incl. FORBIDDEN cases.
- L4 moderator-privilege-gate and mcp-memory-roundtrip tests pass.
- ADR present.
