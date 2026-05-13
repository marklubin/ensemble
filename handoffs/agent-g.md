# HANDOFF — Agent G (feat/ux-session, branch: `agent-g-ux-session`)

## What works

- **Active session screen** (`apps/web/src/screens/session/index.tsx`) — paper-aesthetic port of `mockups/script/index.html`. Renders cover header, cast list with per-seat memory affordance, round-headers, screenplay-style turn blocks with margin-aligned speakers, moderator stage-direction blocks with tool chips, end-of-session footer, fixed dock with queue chips.
- **Typed SSE client** (`apps/web/src/lib/event-stream.ts`) — wraps `EventSource`, validates each event with `SseEvent` (Zod), drops invalid payloads with a console warning, fires typed callbacks keyed by event variant + an optional `any` catch-all, reconnects with exponential backoff up to 15 s. Accepts an injectable `EventSourceCtor` for tests.
- **Session reducer** (`apps/web/src/screens/session/reducer.ts`) — pure mapping `SseEvent → SessionState`. Handles every variant in the discriminated union including `tool.status` pending-chip aggregation and `seat.bypassed`/`cooldown.applied` notice rendering. Side-effect-free; unit-tested with deterministic fixture streams.
- **Queue chips** (`apps/web/src/components/SessionQueueChip.tsx`) — done / current / upcoming / bypassed states derived from reducer state.
- **Moderator card** (`apps/web/src/components/SessionModeratorCard.tsx`) — renders moderator messages, attached tool chips, and (when `?moderator=1`) interactive controls for `force_speaker`, `cooldown`, `bypass`, `inject`. Each control collects args inline and emits a typed `ModeratorAction`.
- **Memory panel** (`apps/web/src/components/SessionMemoryPanel.tsx`) — side panel; loads on open, JSON-pretty-prints each value, supports edit / save / delete with PUT/DELETE.
- **Dock** (`apps/web/src/components/SessionDock.tsx`) — speaking-indicator, textarea (focuses automatically when the server tells us the human seat is up), Submit / Cancel / Buzz-in controls, queue chips. Cmd/Ctrl+Enter submits, Escape cancels.
- **UiBridge client** (`apps/web/src/lib/ui-bridge-client.ts`) — subscribes to `GET /ui-bridge/events`, tracks `focus`/`blur`, POSTs `chunk` / `submit` / `cancel` messages. Streaming policy: **one keystroke = one chunk** (paste = one chunk for the whole pasted block). Documented limitation: backspace is not transmitted as a delta; the watermark is reset so subsequent additions stream correctly, and the final `submit` will be the source-of-truth text once Agent E's server-side bridge processes it.
- **Standalone dev preview** at `/session-preview.html` — boots the session screen with fixture metadata + a scripted reducer feed so we can iterate without depending on the orchestrator's router wiring (which is Phase-2). `bun --filter @ensemble/web dev` then visit `http://localhost:5173/session-preview.html`.

## What's stubbed

- Server endpoints are entirely client-mocked; every `fetch` in the screen catches errors and falls back silently:
  - `GET /sessions/:id` — populates `SessionMeta`. The preview supplies it via `metaOverride`.
  - `GET /sessions/:id/events` — SSE feed; preview injects events through `initialEvents` directly.
  - `GET /sessions/:id/memory/:seat_id`, `PUT|DELETE /sessions/:id/memory/:seat_id/:key` — exercised by tests via a fake fetch.
  - `POST /sessions/:id/moderator/:tool` and `POST /sessions/:id/moderator/inject` — fired from the moderator card.
  - `POST /sessions/:id/human/buzz` — fired from the buzz-in control.
- `apps/web/src/screens/session/reducer.ts` exposes `pending_tools` as a simple key-by-tool map; the moderator card consumes a snapshot of these as `tools` on each `moderator.message`. If the server emits multiple `tool.status` for the same tool between moderator messages, only the last one survives.

## Env vars consumed

- None new. The web app talks to whatever the Vite proxy points at (`http://localhost:4111` for `/sessions`, `/mcp`, etc.).

## Integration edits required at Phase 2

### apps/web/src/App.tsx (router)

```diff
+ import { SessionScreen } from "./screens/session/index.tsx";
...
- <Route path="/session/:id" element={<Placeholder name="Active session (UX-Session)" />} />
+ <Route path="/session/:id" element={<SessionScreen />} />
```

### apps/server — new routes to implement

| Method | Path | Notes |
|---|---|---|
| GET | `/sessions/:id` | Returns `SessionMeta` (shape below). |
| GET | `/sessions/:id/events` | SSE stream of `SseEvent`. Owned by Agent A (scheduler). |
| GET | `/sessions/:id/memory/:seat_id` | Returns `Array<{ key, value }>`. |
| PUT | `/sessions/:id/memory/:seat_id/:key` | Body `{ value }`. Persists `value` JSON-as-is. |
| DELETE | `/sessions/:id/memory/:seat_id/:key` | Removes the entry. |
| POST | `/sessions/:id/moderator/force_speaker` | Body `{ seat_id }`. Server proxies to `moderator.force_speaker` MCP tool with the host's privileged token. |
| POST | `/sessions/:id/moderator/cooldown` | Body `{ seat_id, rounds, reason }`. |
| POST | `/sessions/:id/moderator/bypass` | Body `{ seat_id, reason }`. |
| POST | `/sessions/:id/moderator/inject` | Body `{ content }`. |
| POST | `/sessions/:id/human/buzz` | Body `{ intent, intensity }`. Server is responsible for routing to the `BuzzCoordinator.resolve` path on behalf of the human seat (the human bypasses the SPI per architecture §Human role). |
| GET | `/ui-bridge/events?session_id=…&seat_id=…` | SSE stream of `UiBridgeMessage`. Owned by Agent E (Human UiBridge). |
| POST | `/ui-bridge/messages` | Body is one `UiBridgeMessage`. Owned by Agent E. |
| GET | `/sessions/:id/__diagnostics` | Test-only. Contract below. |

### `SessionMeta` shape (proposed for shared)

```ts
{
  session_id: string,
  template: string,             // "Debate", "Roundtable", "Interview", etc.
  scenario: string,
  scenario_format: ScenarioFormat,
  rounds_planned: number,
  cast: SeatInfo[],             // already in @ensemble/shared
  human_seat_id: string | null,
  turn_taking: TurnTakingMode,
  started_at: string | null,    // ISO datetime
  cost_so_far_usd: number,
}
```

### `/__diagnostics` endpoint contract

Test-only; mounted iff `ENSEMBLE_TEST_MODE === "test"`. Used by the L5 E2E tests to verify backend invariants once the full stack is wired.

```ts
GET /sessions/:id/__diagnostics
Response 200 application/json:
{
  /** Handle IDs currently held by runtimes. Should be empty after session.end. */
  active_handles: string[],

  /** Handle IDs that detach() has been called on this session. */
  detached_handles: string[],

  /** Total SseEvents emitted on this session's /events stream. */
  event_count: number,

  /** Set when session.end has fired. */
  ended: boolean,

  /** Per-seat counters useful for cross-checking the UI's reducer. */
  per_seat: Record<string, {
    turns_completed: number,
    cooldown_remaining: number,
    bypass_count: number,
    /** For the human seat only — number of UiBridge chunks received. */
    ui_bridge_chunks?: number,
  }>,

  /** Concatenation of `turn.end.full_text` values, in emission order.
   *  L5 tests can hash this and compare to the rendered transcript. */
  transcript_digest: string,
}
```

### Buzz-in client flow

1. Session is in `turn_taking: "poll"` and `meta.human_seat_id !== null`. Dock renders the buzz-in input.
2. User types an intent and clicks **Buzz in**. Client POSTs `/sessions/:id/human/buzz` with body `{ intent: string, intensity: number }` (we hard-code intensity to 8 for v1; tune later).
3. Server is expected to resolve the matching `BuzzCoordinator` waiter for the human seat with a `pressed` resolution. The coordinator key is `(session_id, seat_id=human_seat_id, nonce=current_buzz_nonce)`; the server tracks the nonce, the client does not.
4. If the seat is not currently in a buzz-check window, the server should 409 / 425; the client silently swallows in v1.

### SSE event-stream API surface

```ts
import { openEventStream } from "@ensemble/web/lib/event-stream";

const handle = openEventStream({
  url: "/sessions/abc/events",
  handlers: {
    "session.start": (e) => …,
    "turn.delta":    (e) => …,
    any:             (e) => …,   // catch-all
    open:            ()  => …,
    error:           (e) => …,
    invalid:         (raw, reason) => …,
  },
});
handle.close();
```

The same surface is consumed by the session reducer in this package — no
other agents need to import it, but it's stable enough that Agent F (or
anyone building dashboards) can reuse it.

## Types proposed for shared

- **`SessionMeta`** — shape above. Promote from `apps/web/src/screens/session/index.tsx` to `@ensemble/shared` once the server side lands; until then, both sides duplicate.
- **`ModeratorAction`** — declared in `apps/web/src/components/SessionModeratorCard.tsx`. Useful if the server wants to validate inbound moderator proxy calls against the same union.

## Tests delivered

| File | Level | Covers |
|---|---|---|
| `apps/web/src/lib/event-stream.test.ts` | L1 | Validates Zod-filtering, typed callback dispatch, close lifecycle. |
| `apps/web/src/lib/ui-bridge-client.test.ts` | L1 | Focus → chunk → submit round-trip, blur clears focus, no-op when no active turn. |
| `apps/web/src/screens/session/reducer.test.ts` | L1 | Every `SseEvent` variant including `tool.status` aggregation and `queueChips` derivation. |
| `apps/web/src/components/SessionTurnCard.test.tsx` | L1 | Cursor visible while streaming, multi-paragraph rendering, human color class. |
| `apps/web/src/components/SessionQueueChip.test.tsx` | L1 | Each chip state. |
| `apps/web/src/components/SessionModeratorCard.test.tsx` | L1 | Tools, gated controls, force_speaker + inject form submit. |
| `apps/web/src/components/SessionMemoryPanel.test.tsx` | L1 | Load → edit → save round-trip, delete, empty state. |
| `e2e/active-session-render.spec.ts` | L5 | `test.skip` — streams a fixture SSE feed and asserts paper-aesthetic DOM + no console errors. |
| `e2e/memory-panel.spec.ts` | L5 | `test.skip` — edit persists across re-open; concurrent edit during streaming. |
| `e2e/human-seat.spec.ts` | L5 | `test.skip` — UiBridge focus/type/submit; buzz-in poll-mode. |

All L5 specs depend on Playwright being installed (`@playwright/test`) and the server-side endpoints listed above. They are intentionally skipped so the workspace test command stays green.

## New dependencies added

| Name | Version | Reason |
|---|---|---|
| `happy-dom` | ^20.9.0 | DOM polyfill for `bun test` component tests. |
| `@happy-dom/global-registrator` | ^20.9.0 | Registers the polyfill globally (v20 split this out of the main package). |
| `@testing-library/react` | ^16.3.2 | Component rendering + queries in tests. |
| `@testing-library/dom` | ^10.4.1 | Peer dep of `@testing-library/react`. |

All four are devDependencies of `@ensemble/web`. No runtime deps changed.

## Notes for orchestrator

- Merge this branch **last**. The session route swap in `App.tsx` is the only edit needed beyond the runtime registry; Agent F's pre-session screens should land first so the demo flow is end-to-end.
- The standalone preview entry (`apps/web/session-preview.html`) can stay or be removed at integration; it has no impact on the production bundle (separate entry, only loaded when accessed directly).
- The Vite proxy already routes `/sessions`, `/mcp`, etc. to `localhost:4111` — no proxy edits required for the new endpoints listed above as long as they live under those prefixes. The `/ui-bridge/...` endpoints will need an extra `vite.config.ts` proxy entry.
