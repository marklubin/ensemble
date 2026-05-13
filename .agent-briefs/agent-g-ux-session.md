# Agent G — UX In-session (web)

**Branch:** `feat/ux-session`

You implement the active session screen — the live screenplay-style
transcript with streaming turns, queue chips, moderator card, memory
panel, moderator controls, and the human seat's input bridge
client-side.

## Scope (files you own)

- `apps/web/src/screens/session/**` (port the existing mockup)
- `apps/web/src/lib/event-stream.ts` (SSE client)
- `apps/web/src/lib/ui-bridge-client.ts` (client side of the human seat bridge)
- `apps/web/src/components/Session*` (use the `Session*` prefix)

## Off-limits

- `packages/shared/**` (frozen; import types only)
- `apps/server/**`
- `apps/web/src/screens/{templates,casting,personas}/**` (Agent F)
- `apps/web/src/App.tsx` (router edits are orchestrator-only)
- `apps/web/src/main.tsx`, `apps/web/src/theme.css`

## What you build

### Active session screen

`apps/web/src/screens/session/index.tsx` — the main view. Port `mockups/script/index.html` to React faithfully. Match the paper aesthetic, the screenplay format (speaker in margin caps, dialogue paragraphs flush), the moderator stage-direction blocks, the cover header.

State management:
- On mount, subscribe to `GET /sessions/:id/events` via SSE (use `EventSource`).
- Parse incoming events as `SseEvent` from `@ensemble/shared/sse`.
- Maintain a session-state reducer keyed by event type:
  - `session.start` → init
  - `round.start` → record round + speaker order, render queue chips
  - `turn.start` → open a new in-progress turn block for the speaker
  - `turn.delta` → append text to the in-progress turn (streaming animation)
  - `turn.end` → finalize the turn (swap streaming text for rendered markdown if you want; for v1, plain text is fine)
  - `moderator.message` → render a stage-direction block
  - `tool.status` → render the "🔍 Searching: ..." indicator above the moderator content
  - `cooldown.applied`, `seat.bypassed` → minor UI feedback (chip strikethrough, brief notification)
  - `session.end` → freeze the transcript; show end-of-session footer

Queue chips: above or below the transcript area, show the round's speaker order with "done" / "current" / "upcoming" states (per the existing script mockup design).

### Memory panel

Add a memory inspection panel for each persona. Trigger: a small icon next to each seat in the cast list/sidebar. Opens a side panel that:
- Fetches `GET /sessions/:id/memory/:seat_id` (server endpoint; mock if not implemented yet)
- Renders key/value pairs (each value JSON-pretty-printed)
- Provides edit/delete buttons (issue PUT/DELETE to the same endpoint; mock for now)

Document the API contract you expect in HANDOFF.md.

### Moderator controls

If the current user has moderator privileges (for v1, assume yes if a `?moderator=1` query string is present — real auth comes later), surface buttons in the moderator card:
- Force speaker (dropdown of seats)
- Cooldown (seat dropdown + rounds input)
- Bypass (seat dropdown)
- Inject (opens a textarea, when submitted POSTs to `POST /sessions/:id/moderator/inject`)

These hit `POST /sessions/:id/moderator/:tool` proxy endpoints that Agent B exposes (per Agent B's HANDOFF). For now, mock on the client. Document the expected request body shape.

### Human seat input bridge (client side)

`apps/web/src/lib/ui-bridge-client.ts` — client side of Agent E's UiBridge:

- Subscribes to `GET /ui-bridge/events?session_id=...&seat_id=...` SSE stream to know when to focus.
- Maintains a buffer of characters typed by the user.
- POSTs `UiBridgeMessage` (`chunk`, `submit`, `cancel`, etc. — defined in `@ensemble/shared/ui-bridge`) to `POST /ui-bridge/messages`.
- Streams chunks as the user types (one keystroke = one chunk), or batches per word — your call. Document the choice.

The session screen integrates this for the human seat: when the seat is the human's, the textarea autofocuses, characters stream as typed.

### Buzz-in button (poll mode, human seat)

When the session is in `poll` mode and it's a buzz-check moment for the human seat, render a "Buzz in" button. Clicking it POSTs `buzzer.press({intensity: 8, intent: <user's typed intent>})` directly to the MCP endpoint (the human bypasses the SPI for buzz_check). Stub the call for now if the MCP endpoint doesn't accept tokens yet; document.

### event-stream.ts

`apps/web/src/lib/event-stream.ts` — small wrapper around `EventSource` that:
- Validates incoming events with the `SseEvent` Zod schema; drops invalid events with a console warning.
- Exposes a typed callback interface keyed by event variant.
- Handles reconnection on disconnect with backoff.

### Components prefix

Prefix any shared components you put in `apps/web/src/components/` with `Session` (e.g., `SessionTurnCard.tsx`, `SessionQueueChip.tsx`) to avoid colliding with Agent F's `Pre*` components.

### `/__diagnostics` endpoint contract

Define the **expected** contract for a test-only `/sessions/:id/__diagnostics` endpoint that the L5 E2E test will hit to verify backend invariants (e.g., "was detach called on every runtime at session end"). Document the shape in HANDOFF.md; the orchestrator can implement the actual route at integration. Suggested shape: `{ active_handles: string[], detached_handles: string[], event_count: number, ended: boolean }`.

## Test obligations

- **L1 component tests:** the streaming-text component (deterministic feed of chunks → expected DOM state); the queue chip component; the moderator card; the memory panel rendering.
- **L5 Playwright:** `e2e/active-session-render.spec.ts` — boot the app pointing at a test SSE endpoint that emits a scripted event sequence from a fixture file; assert: turn cards stream in, queue chips show the right next-3 seats, moderator card shows round + mode, transcript auto-scrolls, no console errors.
- **L5 Playwright:** `e2e/memory-panel.spec.ts` — open memory panel, edit a value, close + reopen, assert persistence (against a mock or test server endpoint); edit while a turn is streaming, assert no race condition.
- **L5 Playwright:** `e2e/human-seat.spec.ts` (you write this; Agent E listed it too — coordinate via HANDOFF if there's overlap; you own the client-side, E owns the server-side wiring).

## HANDOFF.md must include

- Integration edits:
  - Add session screen route to `App.tsx` router.
  - Mount any new server routes you need (memory inspect/edit, moderator proxy, ui-bridge messages/events). List the exact paths + handler responsibilities so Agent B (MCP) or A (session) can wire them.
  - The `__diagnostics` endpoint contract.
- The SSE event-stream API surface other code might use.
- Document the buzz-in client flow (which endpoint, body shape).
- Note: orchestrator merges this branch LAST.

## Acceptance

- `bun run typecheck` clean.
- `bun test` green for `apps/web` (component tests).
- `bun --filter @ensemble/web dev` renders the session screen at `/session/<any-id>` driven by a stubbed event feed; transcript streams visibly.
- L5 Playwright tests exist (may skip if backing endpoints unimplemented; document).
- Paper-aesthetic styling matches `mockups/script/index.html` faithfully.
