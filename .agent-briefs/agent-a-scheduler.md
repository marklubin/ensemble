# Agent A — Scheduler & Session Routes

**Branch:** `feat/scheduler`

You implement the session scheduler (turn loop, cooldowns, event
emission) and the HTTP routes that drive a session lifecycle. You also
own the L5 flagship E2E test and the L2 SPI conformance suite contents
(the cases shipped in `packages/spi-conformance/`).

## Scope (files you own)

- `apps/server/src/scheduler/**` (currently a stub; replace fully)
- `apps/server/src/session/**` (currently 501 stubs; implement create/start/end/events)
- `packages/spi-conformance/src/**` (currently a no-op; fill in the 25 cases)
- `e2e/full-session.spec.ts` (Playwright; the flagship E2E)

Test files colocated as `*.test.ts` next to source.

## Off-limits

- `packages/shared/**` (frozen)
- `apps/server/src/runtimes/**` (other agents)
- `apps/server/src/mcp/**`, `apps/server/src/memory/**`, `apps/server/src/auth/**` (Agent B)
- `apps/server/src/runtimes/index.ts` (orchestrator-only)
- `apps/web/**` (UX agents)

## What you build

### Scheduler

`apps/server/src/scheduler/index.ts` already has a `SessionScheduler`
skeleton. Replace it with the real implementation. Specifics:

- **Turn-taking modes:** `round-robin`, `shuffled`, `host-driven`, `poll`. `pickOrder()` returns the seat order for the next round (or a single seat for poll-mode-wins). Honor cooldowns.
- **Cooldowns:** after a seat speaks, put them on `cooldown_rounds` (default 1). `tickCooldowns()` decrements at end of round.
- **Poll mode:** call `buzzCheck` in parallel on every idle non-cooldown seat. Highest score wins; quiet-bias optional (boost seats that haven't spoken in K turns). Tie-break random. Pass the winning seat's `intent` as a hint forwarded into their next `takeTurn` (you can include it in the `TurnEvent` list or via a side channel).
- **Host-driven mode:** the seat with `role === "Host"` picks who's next. After each turn, the scheduler emits a `host-pick` request to the host seat; the host's response (delivered as a turn or a metadata callback — your call) determines the next speaker.
- **Run loop:** `runRound()` orchestrates one round; `runSession()` orchestrates rounds until `length` is reached (`open-ended` | `n_rounds=N`).
- **Event emission:** every state transition emits an `SseEvent` (from `@ensemble/shared`) onto an `EventBus`. The bus is your invention but should support multiple subscribers (the SSE endpoint subscribes; later, UI clients subscribe).

Export `EventBus` from `apps/server/src/scheduler/event-bus.ts` so other code can subscribe.

### Session HTTP routes

Replace `apps/server/src/session/routes.ts` with real endpoints:

- `POST /sessions` — body validates against a `CreateSessionRequest` Zod schema you define locally: `{ template_id, scenario, cast: SeatInfo[], turn_taking_mode, length }`. Returns `{ session_id }`.
- `GET /sessions/:id` — returns session state.
- `GET /sessions/:id/events` — **SSE stream**. Subscribe to the `EventBus` for this session, format each `SseEvent` as a `data:` SSE frame, flush on each event.
- `POST /sessions/:id/start` — kick off `runSession()` as a background task; respond immediately.
- `POST /sessions/:id/end` — end gracefully; emits `session.end`.

The scheduler doesn't need to know which runtime is behind a seat — it just calls `runtime.takeTurn(handle, newEvents)` from the registry (`apps/server/src/runtimes/index.ts`). The registry will be empty during your worktree's tests; use a mock/stub `PersonaRuntime` in tests.

### SPI conformance suite

Fill in `packages/spi-conformance/src/index.ts` (`runConformanceSuite`). 25 cases organized into groups (lifecycle, capability honesty, streaming shape, ordering, tools end-to-end, buzzCheck scoring, cancellation, error injection) — see the plan §"SPI Conformance Test Suite" for the full list.

Provide a `MockHostApi` (in-memory implementation of the Host API tool set) that runtime factories can wire into their fixtures. The conformance suite uses `MockHostApi` to assert tool dispatch (e.g., when a recorded fixture "calls" `memory.write`, the suite asserts the MockHostApi recorded the call).

Export everything other runtime packages will need.

## Test obligations

- **L1:** `pickOrder.test.ts` — 100% branch coverage on the picker for all 4 modes + cooldown intersections. Tests must include: round-robin with one cooldown'd seat; shuffled with all eligible; poll mode where one seat returns score 9 and others return 2 (winner selected correctly); host-driven where the host picks a specific seat.
- **L1:** Cooldown ticking unit tests (`cooldowns.test.ts`).
- **L1:** Event bus subscribe/publish/unsubscribe (`event-bus.test.ts`).
- **L3 (shared):** Define the canonical `SseEvent` shape and assert each event variant matches the Zod schema by writing one round through the bus and validating each emitted event (`sse-schema.contract.test.ts` in your scope, but invoked from `apps/server/src/scheduler/`).
- **L4:** `apps/server/tests/integration/scheduler-roundrobin.test.ts` — 3 seats with `RecordedRuntime` instances (you'll need to write a small `RecordedRuntime` impl in `apps/server/src/scheduler/test-helpers/`), 2 rounds, assert 6 turns in order, all events on SSE.
- **L4:** `apps/server/tests/integration/scheduler-poll.test.ts` — same setup, poll mode, scripted buzz scores, assert winners; cooldown decrements over rounds.
- **L5 flagship:** `e2e/full-session.spec.ts` — see plan §"Flagship End-to-End Test" for the full spec. Boot server in fixture mode, drive Playwright through the templates picker → 2-persona debate → assert transcript turns, memory panel, session end. This test depends on Agents F + G's screens existing; you write the test against the fixture mode and the URL routes — it can be skipped if those screens don't exist yet, but the file must exist with a `test.skip()` and a clear comment explaining what runs when integrated.

## HANDOFF.md must include

- Integration edits: none (your scope is self-contained except for the `EventBus` import, which Agent B needs to subscribe to for moderator-injected messages).
- Surface the `MockHostApi` and `RecordedRuntime` helper APIs so other agents can import them from `@ensemble/spi-conformance` (or where you put them).
- Note: orchestrator merges this branch SECOND (after Agent B).

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for `apps/server` and `packages/spi-conformance`.
- L1 `pickOrder` reaches 100% branch coverage (use `bun test --coverage`).
- L4 integration tests run end-to-end with `RecordedRuntime` instances and emit a valid event stream.
- `e2e/full-session.spec.ts` exists; either passes or is documented `test.skip()` pending UX agents.
