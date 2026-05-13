# HANDOFF — Agent B (feat/mcp-auth-memory)

## What works

- **MCP server** (`apps/server/src/mcp/`) using `@modelcontextprotocol/sdk`
  - All 11 Host API tool handlers wired against `HOST_API_TOOLS`
  - Per-token `McpServer` instance — auth context is naturally
    per-connection
  - HTTP transport: `WebStandardStreamableHTTPServerTransport`
    (stateless; identity in the JWT)
  - Public catalogue endpoint `GET /mcp/tools` for sniffing
  - Authenticated RPC endpoint `GET|POST|DELETE /mcp/rpc`
- **Auth** (`apps/server/src/auth/`)
  - HS256 JWT `issue()` / `verify()` with no external deps (Node
    `crypto.createHmac` + `timingSafeEqual`)
  - Hono middlewares: `authMiddleware(secret)`, `requireClaim(name)`,
    `requireSeatMatch(paramName)`
  - Error envelope: `{error: "FORBIDDEN" | "INVALID_TOKEN", message}`
- **Memory** (`apps/server/src/memory/`)
  - `MemoryStore` (in-memory) — default
  - `SqliteMemoryStore` — `bun:sqlite`, composite PK
    `(session_id, seat_id, key)`, JSON-encoded values
  - `createMemoryStore()` picks by `MEMORY_BACKEND`, falls back to
    in-memory if sqlite import fails (pre-authorized COMMON.md
    fallback)
- **BuzzCoordinator** (`apps/server/src/mcp/buzz-coordinator.ts`)
  - `wait(key, timeoutMs)` registers a promise keyed by
    `(session_id, seat_id, nonce)`
  - `resolvePress` / `resolvePass` resolve from the MCP tool handlers
  - `cancel(key)` removes a waiter; timeout resolves with
    `{kind:"timeout"}`
- **Config** (`apps/server/src/config/`) — Zod-validated singleton:
  `{port, anthropicApiKey, mcpPublicUrl, jwtSecret, memoryBackend,
   memorySqlitePath, testMode}`
- **Token / URL minting** exported from `apps/server/src/mcp/`:
  `mintSessionToken({session_id, seat_id, claims, ttlSeconds?})` and
  `getSessionMcpUrl(sessionId)` — both available on
  `defaultMcpServerHost()` (singleton) or via
  `createMcpServerHost(overrides)` for tests/orchestrator
- **EventBus stub** (`apps/server/src/mcp/event-bus.ts`) — local
  `InProcessEventBus` + `IEventBus` so moderator handlers compile and
  test independently of Agent A's scheduler

## What's stubbed

- `apps/server/src/mcp/event-bus.ts` — local `InProcessEventBus`
  stand-in. Replace with `apps/server/src/scheduler/event-bus.ts`
  (Agent A) at integration. Same shape (`publish`/`subscribe` on
  discriminated `BusEvent`).
- `apps/server/src/mcp/session-registry.ts` — local `SessionRegistry`
  with `register` / `unregister` / `get`. The scheduler will register
  a `SessionView` for each live session at start.
- The static catalogue at `GET /mcp/tools` reads from
  `HOST_API_TOOLS`; no live state is returned there.

## Env vars consumed

Add to `apps/server/.env.example`:

```
PORT=4111
ANTHROPIC_API_KEY=
MCP_PUBLIC_URL=http://127.0.0.1:4111
JWT_SECRET=please-replace-with-32+-bytes-of-entropy
MEMORY_BACKEND=in-memory          # in-memory | sqlite
MEMORY_SQLITE_PATH=./ensemble.sqlite
ENSEMBLE_TEST_MODE=fixture        # fixture | live
```

Defaults are picked when unset — a missing `JWT_SECRET` falls back to a
dev placeholder; `MEMORY_BACKEND` defaults to `in-memory`.

## Integration edits required at Phase 2

1. **Wire Agent A's EventBus into the MCP host.** Replace the local
   stub with the scheduler's real one:

   ```ts
   // apps/server/src/index.ts (orchestrator)
   import { EventBus } from "./scheduler/event-bus.ts"; // Agent A
   import { createMcpServerHost } from "./mcp/index.ts";
   import { createMemoryStore } from "./memory/index.ts";

   const memory = await createMemoryStore();
   const bus = new EventBus();
   const mcpHost = createMcpServerHost({ memory, bus });
   app.route("/mcp", mcpHost.app);
   ```

   Replace the default singleton import (`mcpServer`) in
   `apps/server/src/index.ts` with the result of `createMcpServerHost`
   so the bus and memory store are shared with the scheduler.

2. **Scheduler registers session views.** When a session starts,
   call `mcpHost.deps.sessions.register({ session_id, cast, round,
   mode, cooldownFor })`. When it ends, `unregister(sessionId)`.

3. **Scheduler mints tokens for runtimes.** At seat attach, the
   scheduler calls `mcpHost.mintSessionToken({ session_id, seat_id,
   claims: isModerator ? ["moderator"] : [] })` and passes the token
   plus `mcpHost.getSessionMcpUrl(session_id)` into the runtime's
   `SessionContext`.

4. **Subscribe scheduler to moderator events.** The scheduler will
   call `mcpHost.deps.bus.subscribe(handler)` and route `force_speaker`
   / `cooldown` / `bypass` / `inject` payloads into its queue.

5. **Make `BuzzCoordinator` reachable to Agent C / D.** Runtimes that
   need buzz-check should import `mcpHost.deps.buzz` (or re-export
   it from a stable orchestrator-managed module) and call
   `wait({ session_id, seat_id, nonce }, timeoutMs)`. Nonce should be
   echoed by the persona either as a `#nonce:XXX` suffix in
   `intent`/`reason` or — once `BuzzerPressInput` gains a `nonce`
   field — as a top-level arg.

## Types proposed for shared

- **`nonce?: string`** on `BuzzerPressInput` and `BuzzerPassInput` in
  `packages/shared/src/api.ts`. Today we use the `#nonce:XXX` suffix
  in the string fields because shared is frozen; promoting `nonce` to
  a first-class field cleans up the handler and the runtime's prompt.
- **`SessionView`** (from `apps/server/src/mcp/session-registry.ts`)
  could move to shared if Agent A wants to expose it on the
  scheduler's public API. Keeping it server-local is also fine.

## Tests delivered

- `apps/server/src/auth/jwt.test.ts` — L1. Round-trip; tampered
  signature; tampered payload; wrong secret; expired token; malformed;
  `hasClaim`.
- `apps/server/src/memory/store.test.ts` — L1. Write/read; namespace
  isolation by `(session, seat)` and session; list; dump; overwrite.
- `apps/server/src/memory/sqlite-store.test.ts` — L1. Same coverage
  against `:memory:` sqlite; verifies JSON round-trip of objects.
- `apps/server/src/mcp/buzz-coordinator.test.ts` — L1. Press/pass
  resolution; timeout; cancel; concurrent waiters by nonce; unknown
  nonce.
- `apps/server/src/mcp/contract.test.ts` — L3. All 11 tools via the
  MCP SDK in-process client. Happy paths for each; FORBIDDEN on all
  four moderator tools without the claim; INVALID_INPUT cases for
  schema violations; buzzer-nonce via `#nonce:XXX` suffix.
- `apps/server/tests/integration/moderator-privilege-gate.test.ts` —
  L4. Two clients with different JWTs; cast seat's force_speaker
  returns FORBIDDEN with zero side-effects; moderator's identical
  call publishes the event. All four moderator tools covered.
- `apps/server/tests/integration/mcp-memory-roundtrip.test.ts` — L4.
  `memory.write({key:"x", value:42})` then `memory.read({key:"x"})`
  through the MCP SDK; persistence confirmed in the underlying store;
  complex objects round-trip; list reports written keys; sqlite path
  variant.

54 tests pass via `bun test apps/server`. `bun run typecheck` clean
across the whole workspace.

## New dependencies added

None. Phase-0 pins satisfy everything — `@modelcontextprotocol/sdk`,
`hono`, `zod`. JWT is hand-rolled on `node:crypto` (already available
in Bun).

## Notes for orchestrator

- **This branch is merged first** — Agents A (scheduler), C (managed
  agents), D (claude code) depend on the `mintSessionToken` /
  `getSessionMcpUrl` / `BuzzCoordinator` surfaces.
- `defaultMcpServerHost()` is a process-wide singleton; the
  orchestrator should call `createMcpServerHost({memory, bus})` instead
  (with the scheduler's bus) and mount `host.app` at `/mcp`, replacing
  the singleton `mcpServer` import in `apps/server/src/index.ts`.
- The legacy stub endpoint `POST /mcp/call/:tool` (returning 501) has
  been removed in favor of MCP-native `/mcp/rpc`. If anything in
  `apps/web` was poking the old shape, it must move to the SDK client.
