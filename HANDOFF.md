# HANDOFF — Agent E (feat/runtime-human / branch `agent-e-human-uibridge`)

Server-side `UiBridge` + `HumanRuntime` for Ensemble v1.

## What works

- **`UiBridge`** in-process registry mapping `(session_id, seat_id) → seat
  registration`, including:
  - `register / unregister / has`
  - `inboundFor(session_id, seat_id, turn_id) → AsyncIterable<UiBridgeMessage>`
    backed by a buffering single-consumer queue.
  - `cancelTurn / endTurn` lifecycle hooks.
  - `emitFocus / emitBlur` outbound events (buffered when no SSE
    subscriber is attached; bounded to 64 entries).
  - `ingest(msg, session_id)` — in-process producer surface, also used by
    the HTTP route.
- **HTTP routes** (`bridge.routes` — a Hono sub-app):
  - `POST /messages` — body `{ session_id, message: UiBridgeMessage }`
    (Zod-validated). 200 on accept, 400 on invalid payload, 409 if no
    active turn matches the message's `seat_id` + `turn_id`.
  - `GET /events?session_id=…&seat_id=…` — SSE stream emitting `ready`,
    `focus`, `blur` events; pending outbound events are flushed on
    subscribe, so a late subscriber doesn't miss the focus event for the
    current turn.
- **`HumanRuntime`** — implements `PersonaRuntime`:
  - `name = "human"`, `defaultCapabilities = { "streaming" }`.
  - `attach` registers the seat with the UiBridge using the persona name,
    returns a handle with a random UUID id.
  - `takeTurn` emits `focus`, consumes the bridge's inbound iterable,
    yields `chunk.text` strings, resolves on `submit` or `cancel`,
    always emits `blur` in `finally`.
  - `buzzCheck` always returns `{ score: 0, intent: "", can_pass: true }`
    even though `buzz_check` is not in the capability set (per the brief
    — web UI handles buzz via `buzzer.press` directly on the MCP
    endpoint, owned by Agent G).
  - `detach` cleans up the bridge registration.
- **Tests passing (31 across 4 files):**
  - L1 UiBridge: buffering, cancellation, multi-turn isolation, HTTP
    POST routing, SSE flushing of buffered events, error responses.
  - L1 HumanRuntime: lifecycle, streaming order, multi-turn fresh
    inputs, optional turn-timeout, focus/blur emission.
  - L2 SPI conformance: `runConformanceSuite("human", factory)` is
    invoked (currently a Phase-0 no-op; Agent A's case suite will
    populate it). Local SPI-shape checks assert
    `defaultCapabilities`, the no-buzz response shape, and idempotent
    detach.
  - L4 integration (`tests/integration/human-seat-bridge.test.ts`):
    drives the Phase-0 `SessionScheduler` skeleton end-to-end —
    POSTs chunks + submit over HTTP, asserts the scheduler's event
    log contains a single `turn` event with the concatenated content;
    a second case exercises the cancel path.
- **L5 Playwright spec** at `e2e/human-seat.spec.ts` (currently
  `test.describe.skip`) — drafted to assert focus on turn, per-character
  appearance in the transcript within 200 ms, and submit ending the
  turn. Unskip once Agent G ships the in-session UI.

## What's stubbed

- `e2e/human-seat.spec.ts` is `describe.skip` pending Agent G's UI.
  Selectors in the spec are placeholders matching the intent of Agent
  G's brief; Agent G should adjust them when the DOM lands.
- The L2 conformance suite's actual cases are still Phase-0 no-ops
  (`packages/spi-conformance/src/index.ts`). Once Agent A populates the
  25 cases, `apps/server/src/runtimes/human/conformance.test.ts`
  automatically exercises them — no edits required here.
- The L4 test uses an `(scheduler as unknown as { events: [] }).events`
  cast to read the scheduler's event log because the Phase-0 skeleton
  doesn't expose an accessor. When Agent A merges, swap to whatever
  public accessor they ship.

## Env vars consumed

- None. UiBridge is in-process; no new env vars required.

## Integration edits required at Phase 2

In `apps/server/src/runtimes/index.ts` (orchestrator-only):

```ts
import { HumanRuntime } from "./human/index.ts";
import { UiBridge } from "../ui-bridge/index.ts";

export const uiBridge = new UiBridge();
runtimes["human"] = new HumanRuntime(uiBridge);
```

In `apps/server/src/index.ts` (orchestrator-only):

```ts
import { uiBridge } from "./runtimes/index.ts";
// …
app.route("/ui-bridge", uiBridge.routes);
```

Notes:
- `HumanRuntime` and `UiBridge` are one-to-one in v1 (a single bridge
  instance serves every human seat across all sessions). The registry
  keys on `(session_id, seat_id)` so multi-session is fine.
- `HumanRuntime` accepts an optional `{ turnTimeoutMs }` option; left
  unset, turns remain pending until a `submit` or `cancel` arrives, or
  until the seat is unregistered.

## Types proposed for shared

- `OutboundEvent` (`{ kind: "focus" | "blur"; seat_id; turn_id; persona_name? }`)
  is currently local to `apps/server/src/ui-bridge/index.ts`. If the web
  client wants a typed SSE handler, promote this type to
  `@ensemble/shared/ui-bridge.ts` as a sibling discriminated union to
  `UiBridgeMessage`. Optional — Agent G can also just parse the JSON
  payloads against the SSE `event:` field.

## Tests delivered

- `apps/server/src/ui-bridge/index.test.ts` — L1 UiBridge buffering,
  cancellation, multi-turn isolation, HTTP/SSE behavior. (15 tests)
- `apps/server/src/runtimes/human/index.test.ts` — L1 HumanRuntime
  lifecycle, streaming order, buzz response shape, focus/blur emission,
  optional turn timeout. (10 tests)
- `apps/server/src/runtimes/human/conformance.test.ts` — L2 wiring to
  `runConformanceSuite("human", factory)` plus local SPI-shape checks. (4 tests)
- `apps/server/tests/integration/human-seat-bridge.test.ts` — L4
  end-to-end: HTTP POST → UiBridge → HumanRuntime.takeTurn →
  SessionScheduler turn event. (2 tests)
- `e2e/human-seat.spec.ts` — L5 Playwright spec (skipped pending Agent G's UI).

## New dependencies added

- `@ensemble/spi-conformance` (workspace package, devDependency) added
  to `apps/server/package.json` so the conformance test file can import
  it. No external/npm deps added.

## Configuration changes

- `bunfig.toml` (new, at workspace root): `[test] pathIgnorePatterns =
  ["**/e2e/**", "**/node_modules/**"]` so `bun test` does not pick up
  the Playwright spec (which imports `@playwright/test`, not installed
  in this worktree). Playwright is intended to be run by a separate
  config (orchestrator land).
- `apps/server/tsconfig.json`: `include` extended to `["src/**/*",
  "tests/**/*"]` so the L4 test under `apps/server/tests/integration/`
  is included in `bun run typecheck`.

## No-connected-client behavior (documented per brief)

If `takeTurn` is invoked and no web client has subscribed to the
outbound SSE stream:
- `emitFocus` is buffered in the registration's `pendingOutbound` queue
  (capacity 64). When a subscriber connects, the buffered focus event is
  flushed first — so a late subscriber still focuses the textarea.
- The inbound queue stays empty; the AsyncIterable remains pending.
- If `HumanRuntime` was constructed with `turnTimeoutMs > 0`, the queue
  is cancelled on timeout and the turn resolves with whatever (zero or
  more) chunks have already arrived.
- If no timeout is set (default), the turn remains pending until either
  the client posts `submit`/`cancel`, the scheduler calls
  `bridge.cancelTurn`, or the seat is unregistered (`detach`).

## Merge order

Per the brief, orchestrator merges this branch **third** (after Agent B
and Agent A).
