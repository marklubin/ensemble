# HANDOFF — Agent A (feat/scheduler)

Branch: `agent-a-scheduler` (created from `main`; brief named `feat/scheduler`
— rename at merge if preferred).

## What works

- **`SessionScheduler`** (`apps/server/src/scheduler/index.ts`) — all four
  turn-taking modes (`round-robin`, `shuffled`, `host-driven`, `poll`).
  - `runSession()` drives `runRound()` until `length` is reached
    (`open-ended` | `n_rounds=N`) or `requestEnd()` is called.
  - `runRound()` emits `round.start` / `round.end`, runs each turn, and
    ticks cooldowns.
  - `runTurn()` emits `turn.start` → many `turn.delta` → `turn.end`, and
    pushes a `TurnEvent` into the shared event log.
  - Re-checks per-seat eligibility per turn (so an earlier turn that
    applied a cooldown bypasses the affected seat with `seat.bypassed`).
  - Moderator hooks: `applyCooldown`, `forceSpeaker`, `injectModeratorMessage`.
  - Poll mode: collects buzz responses in parallel via the SPI, forwards
    the winning intent into the winner's next `takeTurn` as a synthetic
    moderator event.
  - Host-driven mode: delegates to an injected `hostPicker` callback.
- **`EventBus`** (`apps/server/src/scheduler/event-bus.ts`) — multi-
  subscriber, throwing-subscriber-safe, exported from
  `apps/server/src/scheduler/index.ts`. Agent B should import this to
  inject moderator-injected messages via `bus.publish(...)`.
- **`CooldownTracker`** (`apps/server/src/scheduler/cooldowns.ts`) —
  longer-wins apply semantics, per-round tick, snapshot-for-picker.
- **`pickOrder`** (`apps/server/src/scheduler/pick-order.ts`) — pure
  functions, 100% branch coverage. Modes + cooldown intersections,
  Fisher–Yates shuffle, poll-winner with quiet-bias and deterministic
  tie-break.
- **Session HTTP routes** (`apps/server/src/session/routes.ts`):
  - `POST /sessions` — validates `CreateSessionRequest` (local Zod
    schema), creates state in `SessionStore`, returns `{ session_id }`.
  - `GET /sessions` / `GET /sessions/:id` — list + summary.
  - `GET /sessions/:id/events` — SSE stream, subscribes to the bus,
    serializes each `SseEvent` as `event:<type>\ndata:<json>` frames.
  - `POST /sessions/:id/start` — resolves runtimes (per-session
    override → global registry), builds the scheduler, kicks off
    `start()` as a background task, returns 200 immediately.
  - `POST /sessions/:id/end` — graceful end.
  - Test seam: `setSessionRuntimes(sessionId, map)` and
    `setSessionHandles(sessionId, map)` inject `RecordedRuntime`s
    without touching the orchestrator-owned global registry.
- **`RecordedRuntime`** (`apps/server/src/scheduler/test-helpers/`) —
  deterministic in-memory `PersonaRuntime` for scheduler tests.
  Scripts `takeTurn` chunks and `buzzCheck` responses per seat; records
  every interaction for assertion.
- **`MockHostApi`** (`packages/spi-conformance/src/mock-host-api.ts`) —
  in-memory implementation of all 11 Host API tools. Records every
  call; runtime fixtures can wire it as their tool dispatcher.
- **SPI conformance suite** (`packages/spi-conformance/src/index.ts`) —
  25 test cases covering lifecycle, capability honesty, streaming
  shape, ordering, tool round-trips, buzzCheck scoring, cancellation,
  and error injection. Exported helpers:
  - `runConformanceSuite(name, factory, opts?)`
  - `MockHostApi` (+ types)
  - `ConformanceFactory`, `ConformanceFixture` types

## What's stubbed

- `apps/web/**` is untouched (UX agents F + G own it).
- `e2e/full-session.spec.ts` is `test.skip()` pending Agents F + G
  shipping the templates picker and in-session screens. The test body
  documents the exact selectors and routes it expects.
- The scheduler does NOT call `attach`/`detach` on runtimes — that's
  expected to happen one level up (orchestrator's session lifecycle
  manager). The route currently relies on the test-only handle
  override; the production path needs an `attach` pass after Agent C
  lands a real `ManagedAgentsRuntime`. See "Integration edits required".

## Env vars consumed

- None new. (`PORT` already documented in `apps/server/src/index.ts`.)

## Integration edits required at Phase 2

1. **Runtime registry wiring** — orchestrator-only file
   `apps/server/src/runtimes/index.ts`. Once Agents C/D/E land:
   ```ts
   runtimes['managed-agents'] = new ManagedAgentsRuntime(client);
   runtimes['human']           = new HumanRuntime(uiBridge);
   // optional: runtimes['claude-code'] = new ClaudeCodeRuntime(...);
   ```
2. **Attach pass before `/start`** — the production session-start flow
   needs to call `runtime.attach(persona, ctx)` per seat *before* the
   scheduler runs. Suggested home: a small helper in
   `apps/server/src/session/lifecycle.ts` that runs in the same place
   the route currently checks for overrides. Recorded-runtime tests
   bypass this with `setSessionHandles`.
3. **MCP token issuance** — `CreateSessionRequest` does not yet build
   per-seat MCP tokens for the `SessionContext`. Agent B (Host API)
   owns the token format; route-level wiring will call into B's token
   issuer here.
4. **Moderator-injected messages** — Agent B's MCP server should
   `import { EventBus } from "../scheduler/event-bus"` and `publish`
   `moderator.message` events directly onto the session's bus when
   `moderator.inject` fires. The bus is the only cross-agent surface;
   no other shared mutation is needed.
5. **Web router** — `apps/web/src/App.tsx` is orchestrator-only.
   E2E test expects routes `/`, `/setup/:templateId`, `/session/:id`.

## Types proposed for shared

None. Local types kept inside this worktree:

- `SessionLength` (in `apps/server/src/scheduler/index.ts`) —
  `{ kind: "open-ended" } | { kind: "n_rounds"; n: number }`.
  Suggested promotion target: `packages/shared/src/session.ts`.
- `PollResult` (in `apps/server/src/scheduler/pick-order.ts`) — only
  consumed inside the scheduler; no promotion needed unless a UI
  agent wants to inspect poll outcomes.
- `CreateSessionRequest` (in `apps/server/src/session/routes.ts`) —
  HTTP request shape. Could move to a future
  `packages/shared/src/http.ts`.

## Tests delivered

L1 (colocated `*.test.ts`):
- `apps/server/src/scheduler/pick-order.test.ts` — picker, all 4 modes,
  cooldowns, shuffle, poll winner. ~30 cases, designed for 100% branch
  coverage.
- `apps/server/src/scheduler/cooldowns.test.ts` — `CooldownTracker`
  semantics: apply, tick, snapshot, clear, bypass.
- `apps/server/src/scheduler/event-bus.test.ts` — subscribe / publish /
  unsubscribe / throwing subscriber / iteration safety / close.

L3 contract:
- `apps/server/src/scheduler/sse-schema.contract.test.ts` — runs one
  round end-to-end and validates every emitted event against the
  shared `SseEvent` Zod schema.

L4 integration (`apps/server/tests/integration/`):
- `scheduler-roundrobin.test.ts` — 3 seats × 2 rounds, asserts 6 turns
  in canonical order with valid SSE events.
- `scheduler-poll.test.ts` — 3 seats × 3 rounds, scripted buzz scores,
  asserts winner-per-round and cooldown decrement; second case for
  empty rounds.
- `scheduler-host-driven.test.ts` — `hostPicker` callback drives 3
  rounds; picks honored.
- `session-routes.test.ts` — full HTTP flow: create → inject runtimes
  → SSE → start → drain → end. Validation errors, missing runtimes.

L2 self-test (`packages/spi-conformance/src/`):
- `mock-host-api.test.ts` — every tool case on `MockHostApi`.
- `self.test.ts` — runs the 25-case conformance suite against a
  reference runtime in-package; verifies the suite is internally
  consistent.

L5 E2E:
- `e2e/full-session.spec.ts` — `test.skip()`, fully written with
  selectors/routes against fixture mode. Drop the `.skip` once F + G
  land.

## New dependencies added

None. Used existing `hono` (for `streamSSE`), `zod`, and `@types/bun`
(added to `packages/spi-conformance/devDependencies` so the new
`bun:test` import resolves — pinned versions unchanged).

## Acceptance gate results

- `bun run typecheck` — clean across all four workspaces.
- `bun test apps/server packages/spi-conformance` — 93 tests pass, 0
  fail, 211 expect() calls. (The single `console.error` line in the
  output is from the deliberately-throwing subscriber in the event-bus
  test; suppressed-but-logged is the bus's documented behavior.)
- `e2e/full-session.spec.ts` exists with documented `test.skip()`
  pending UX worktrees.

## Notes for the orchestrator

- Merge order requested by brief: this worktree is SECOND (after
  Agent B).
- `EventBus` is the only cross-agent surface I introduce. Agent B
  should subscribe (for moderator-injected messages) and Agent G's
  web client subscribes via the SSE route.
- The HTTP route's `runtime_unavailable` 400 short-circuits when seats
  lack runtimes. In Phase 2 integration this is the surface that
  triggers when a registry entry is missing — surface it as a clear
  user-facing error in the UX layer.
