# Agent E — HumanRuntime + UiBridge (server side)

**Branch:** `feat/runtime-human`

You implement the SPI adapter that represents a human seat in a
session, and the server-side UI bridge that wires the human's typing
in the web UI into the SPI's streaming interface.

## Scope (files you own)

- `apps/server/src/runtimes/human/**` (new)
- `apps/server/src/ui-bridge/**` (new)

## Off-limits

- `packages/shared/**` (frozen; you import `UiBridgeMessage` from `@ensemble/shared/ui-bridge`)
- Other runtime directories
- `apps/server/src/scheduler/**`, `apps/server/src/mcp/**`, `apps/server/src/memory/**`, `apps/server/src/auth/**`
- `apps/server/src/runtimes/index.ts`
- `apps/web/**` (client-side bridge is Agent G's job; you only own the server side)

## What you build

### UiBridge (server side)

`apps/server/src/ui-bridge/index.ts` — an in-process registry that maps
`(session_id, seat_id)` to an active bridge for that seat. The bridge
buffers incoming `UiBridgeMessage` (from `@ensemble/shared/ui-bridge`)
arriving from the web client and exposes them as async iterables for
the HumanRuntime to consume.

API sketch (define exactly):

```ts
export interface UiBridge {
  /** Server tells the client to focus this seat's input. */
  emitFocus(session_id, seat_id, turn_id): void;

  /** Server tells the client to blur this seat. */
  emitBlur(session_id, seat_id, turn_id): void;

  /** Subscribe to the message stream the client is sending for this seat+turn. */
  inboundFor(session_id, seat_id, turn_id): AsyncIterable<UiBridgeMessage>;
}
```

Plus an HTTP route for the client to POST messages:

- `POST /ui-bridge/messages` — body is a `UiBridgeMessage` (validate with Zod from `@ensemble/shared`). Server routes the message into the matching inbound stream. Returns 200.

And an outbound channel — could be SSE:

- `GET /ui-bridge/events?session_id=...&seat_id=...` — SSE stream the client subscribes to; receives `focus` / `blur` events emitted by the runtime.

(If SSE for outbound feels heavy, you can piggyback on the scheduler's SSE event stream by adding `ui-bridge.focus` / `ui-bridge.blur` event variants — but `SseEvent` is in the frozen shared package and you can't add variants. Better to run the bridge's outbound as its own SSE stream. Document the choice.)

### HumanRuntime

`apps/server/src/runtimes/human/index.ts` — class implementing `PersonaRuntime`.

Default capabilities: `{ "streaming" }` only. No `buzz_check`.

- **`attach(persona, ctx)`** — register the seat with the UiBridge (so the bridge knows the persona name / role for display). Generate a handle with a random ID. Return.
- **`takeTurn(handle, _events)`** — emit a `focus` event on the bridge; subscribe to the bridge's inbound stream for this turn; yield `text` chunks from `chunk` messages; resolve when a `submit` arrives or the iterable is broken. Emit a `blur` event at end.
- **`buzzCheck()`** — return `{score:0, intent:"", can_pass:true}` immediately. The web UI surfaces a separate Buzz button that calls `buzzer.press` directly on the MCP endpoint — that's Agent G's job to wire client-side. The SPI's `buzzCheck` method, in this case, is functionally absent.
- **`detach(handle)`** — clean up the bridge registration for this seat.

Implementations should be defensive: if no client is connected when `takeTurn` is called (no `focus` event reaches anyone), the iterable should still resolve after a reasonable timeout or remain pending until the client connects. Document the behavior.

## Test obligations

- **L1:** `apps/server/src/ui-bridge/index.test.ts` — buffering/cancellation of inbound messages; multiple turns one after another don't cross-contaminate; submit cleanly closes the iterable.
- **L1:** `apps/server/src/runtimes/human/index.test.ts` — attach/detach lifecycle; takeTurn yields characters in the right order from scripted UiBridge inputs; buzzCheck always returns the no-buzz response.
- **L2:** `conformance.test.ts` — `runConformanceSuite("human", factory)` from `@ensemble/spi-conformance`. The factory wires `HumanRuntime` to a scripted UiBridge. **The suite must handle the absence of `buzz_check` capability** — verify the behavior per the SPI spec (call `buzzCheck` and expect the no-buzz response, since the runtime explicitly returns one even without declaring the capability).
- **L4 integration:** `apps/server/tests/integration/human-seat-bridge.test.ts` — start a session with one human seat (using a stub for the scheduler if A's code isn't ready in your worktree — use the `MockHostApi` if available, else stub); POST UiBridge messages over HTTP; assert the scheduler's `runTurn` got the characters streamed correctly into the transcript.
- **L5 (you contribute the Playwright test, not run it):** `e2e/human-seat.spec.ts` — written but possibly skipped pending Agent G's UI. Configure a session with one human seat; when the seat's turn comes, the textarea focuses; typed characters appear in the transcript live (assert character-by-character presence within 200ms); submit ends the turn.

## HANDOFF.md must include

- Integration edit: `runtimes['human'] = new HumanRuntime(uiBridge)` in the registry. Plus mounting the UiBridge routes in Hono: `app.route('/ui-bridge', uiBridge.routes)`.
- The `UiBridge` API surface (the public methods other code calls).
- Document the no-connected-client behavior (timeout vs. pending).
- Note: orchestrator merges this branch THIRD (after B, A).

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for your scope.
- L1 UiBridge + HumanRuntime tests pass.
- L2 SPI conformance passes for the no-buzz-capability case.
- L4 human-seat-bridge integration test passes (or is documented as needing Agent A's merged scheduler).
