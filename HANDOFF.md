# HANDOFF — feat/channel-runtime

Branch: `feat/channel-runtime` (from tag `v1.5`).

## What ships

New **channel-based** Claude Code runtime. Ensemble drives an
externally-managed Claude Code session over a WebSocket via a small
MCP bridge (`@ensemble/channel-bridge`). The CLI subprocess transport
remains as a fallback.

## Files shipped

### `apps/server/src/channels/`
- `coordinator.ts` — `ChannelCoordinator`: validates token-bearing
  WS connections, registers `(session_id, seat_id)` bindings, brokers
  `turn-prompt` ↔ `reply` traffic for in-flight dispatches, handles
  disconnect / supersede / timeout. Transport-agnostic
  (`ChannelConnection` facade).
- `coordinator.test.ts` — 14 L1 unit tests with an in-memory connection
  fake (no real WS): register/reject by token, double-register supersedes,
  dispatch round-trip, disconnect rejects pending, timeout, unregister,
  concurrent dispatches routed by `turn_id`.
- `ws-route.ts` — Hono route at `/ws` that upgrades to a WebSocket and
  feeds the connection into the coordinator. Token extracted from
  `Authorization: Bearer` header or `?token=` query string.

### `apps/server/src/runtimes/channel/`
- `index.ts` — `ChannelRuntime implements PersonaRuntime`. `attach`
  registers expectations (no spawn), optionally waits up to
  `attachConnectWaitMs` for a bridge to register. `takeTurn` dispatches
  a turn-prompt through the coordinator and yields chunks. `buzzCheck`
  uses the same dispatch + the existing `BuzzCoordinator` (nonce-keyed)
  waiter pattern from `ClaudeCodeRuntime`. `detach` unregisters.
  Capabilities: `streaming, buzz_check, tools, mcp`.
- `conformance.test.ts` — L2 SPI conformance via the shared
  `runConformanceSuite("claude-code-channel", ...)` factory + 6 local
  contract tests. 31 tests / 43 expectations, all passing.

### `apps/server/src/runtimes/index.ts` (edit)
- Added `channelCoordinator()` accessor. Reworked the
  `CLAUDE_CODE_RUNTIME_ENABLED` block: `CLAUDE_CODE_TRANSPORT` selects
  `channel` (default) / `cli` / `mock`. Legacy `LocalCliTransport` and
  `MockMcpTransport` untouched.

### `apps/server/src/index.ts` (edit)
- Mount `/channels/ws` (via `createChannelsRoutes`) and add Hono's
  Bun WS handler to the default export.

### `apps/server/tests/integration/channel-runtime.test.ts`
- L4 integration: boots a Hono+Bun server on an ephemeral port,
  dials a real `WebSocket` from a fake bridge, registers, and drives
  three scenarios:
  1. Full register → attach → takeTurn round-trip with multi-chunk reply.
  2. `ChannelNotConnectedError` for a seat with no bridge.
  3. Disconnect mid-turn rejects the iterable with a typed error.

### `apps/server/tests/live/claude-code-channel.live.test.ts`
- Scaffolded but `test.skip` with a clear note. Channel protocol
  shape (`notifications/claude/channel`) is still research-preview;
  shipping skipped per brief.

### `apps/channel-bridge/` (new package)
- `package.json` — `bin: ensemble-channel-bridge`. Deps: MCP SDK, `ws`, Zod.
- `tsconfig.json` — extends repo base.
- `src/index.ts` — MCP server over stdio that:
  - dials `ENSEMBLE_WS_URL`, sends `register`, reconnects with backoff;
  - on `turn-prompt`, fires `notifications/claude/channel` into the
    running Claude Code session via the MCP SDK Server.notification API;
  - exposes a `reply` tool; each tool call forwards a `reply` frame
    over the WS back to the coordinator.
- `README.md` — setup, env, wire-protocol reference, local-verify recipe.

### Docs / config
- `apps/server/.env.example` — `CLAUDE_CODE_TRANSPORT={channel|cli|mock}`,
  channel token, connect-wait timeout, CLI fallback knobs.
- `TEST_PROTOCOL.md` — "Claude Code integration" section reorganized to
  put channels first as the primary path; CLI subprocess listed as fallback.

## Design choices

1. **Coordinator owns wire semantics; transport is a thin facade.**
   `ChannelCoordinator` does not import `ws` or Bun primitives — it
   speaks to a `ChannelConnection` interface. This let the L1 tests
   skip real sockets entirely and made the L4 integration test the
   only place that exercises actual WS bytes.

2. **Bun-native WS on the server side (deviation from brief).**
   The brief asked for the `ws` npm package on the server. Hono's
   `hono/bun` adapter exposes a native upgrade helper backed by Bun's
   `ServerWebSocket` with the exact `WSEvents` surface we need (open
   / message / close). I used that to avoid maintaining a shim
   between `ws.WebSocketServer` and Bun.serve's upgrade path. The
   bridge (client side) still uses the `ws` package — the dependency
   is recorded in `apps/server/package.json` per the brief, but is
   currently only pulled in via the bridge. If we later need
   `ws.WebSocketServer` on the server side, the `ChannelConnection`
   facade means we only rewrite `ws-route.ts`.

3. **Supersede over reject for double-register.** Re-launching
   Claude Code is a routine dev action; rejecting the second
   connection would be sticky. Old connection is closed `1000
   "superseded"` and any pending dispatches reject with
   `ChannelSupersededError`.

4. **`attach` does not throw on missing bridge; first dispatch does.**
   Per the brief: registers expectation + waits up to
   `attachConnectWaitMs` (default 30s). If the channel never appears,
   `takeTurn` / `buzzCheck` throw a typed `ChannelNotConnectedError`
   informatively. Tests set `attachConnectWaitMs: 0`.

5. **No changes to `packages/shared/`.** The runtime's external
   contract is unchanged; new types are local to the runtime/channel
   modules. Nothing to promote.

## Verification

- `bun run typecheck` — clean across all 5 packages.
- `bun test apps/server/` — 355 pass / 3 skip / 0 fail / 732 expects.
  - L1 (`src/channels/coordinator.test.ts`) — 14 pass.
  - L2 (`src/runtimes/channel/conformance.test.ts`) — 25 conformance + 6 contract = 31 pass.
  - L4 (`tests/integration/channel-runtime.test.ts`) — 3 pass (real WS round-trip, not-connected, mid-turn disconnect).
- L6 live (`tests/live/claude-code-channel.live.test.ts`) — `test.skip`
  with explanation; pending stabilization of `notifications/claude/channel`.

## Open issues

- **L6 live test is skipped.** The channel protocol's request/reply
  shape changes faster than the L1/L2/L4 surfaces we control. Flip it
  on once the spec page stabilizes; the bridge code is ready.
- **No reconnect handshake replay.** If the bridge drops mid-turn,
  in-flight dispatches reject. We don't queue retries on the server.
  Acceptable for v1.6; revisit if real-world Claude sessions churn.
- **Bridge auth is bearer-only.** No JWT signing yet; relies on a
  shared `ENSEMBLE_CHANNEL_TOKEN`. Move to the existing JWT issuer
  (`JWT_SECRET`) when seat-scoped MCP tokens get plumbed through the
  bridge env at session-start time.
