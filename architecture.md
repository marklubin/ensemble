# Ensemble — Architecture (engineering handoff)

<!-- updated: 2026-05-12 -->

## Product

- Web app for multi-persona scene simulations: debates, roundtables, interviews, writers' rooms, mock trials.
- Assemble a cast of personas, give them a scenario, watch them play it out as a streamed screenplay-style transcript.
- Personas are portable specs (name, system prompt, role, voice, buzz-in policy).
- The runtime executing each persona is pluggable per-seat — same session can mix Managed Agents, Claude Code, and a human.

## The contract

- One bidirectional contract between Ensemble and any runtime.
- Pattern: plug-in architecture with **SPI + Host API** (Java/OSGi convention; same shape as Wasm Component Model's imports/exports).
  - **SPI** — what runtimes implement; Ensemble calls in.
  - **Host API** — what Ensemble exposes (over MCP); runtimes call back.
- Why this shape: modern agent runtimes already do chat loops, tools, streaming, and state. Don't reimplement; bridge.

## SPI

**What.** Four operations + capability flags. The contract a runtime must satisfy to participate in a session.

**Why.** Lets Ensemble drive the session (whose turn, what events) without owning the chat loop.

**Operations:**

- `attach(persona, ctx) → handle` — provision an instance of this persona in the runtime; return an opaque handle and its capability set.
- `takeTurn(handle, newEvents) → AsyncIterable<string>` — feed events the runtime hasn't seen yet; stream the response back chunk by chunk.
- `buzzCheck(handle, recentTurns) → { score, intent, can_pass }` — poll-mode self-select; persona answers "do you want to speak?"
- `detach(handle)` — clean up the instance.

**Capabilities** (declared at attach time):

- `streaming` — produces an async string stream
- `buzz_check` — supports programmatic buzz-check
- `tools` — honors `tools_allowed`
- `mcp` — can call MCP servers
- `memory_inspection` — exposes its memory to Ensemble
- `pause_resume` — can be paused cheaply

Sessions requesting a capability the runtime doesn't declare either degrade gracefully or refuse to cast that runtime.

## Host API

**What.** A set of MCP tools served per-session. Personas running inside the runtime call these like any other tool.

**Why.** MCP is already how agents call external tools. No new protocol on top. Buzzer, memory, metadata, and moderator powers are all tools — no separate command channel.

**Tools:**

Turn signaling
- `buzzer.press(intensity, intent)` — signal a desire to speak (buzz-check responses + out-of-turn requests)
- `buzzer.pass(reason?)` — decline a turn

Memory (session-scoped; the store lives on Ensemble's side)
- `memory.read(key)`
- `memory.write(key, value)`
- `memory.list()`

Session metadata
- `cast.list()` — seats + roles
- `round.info()` — round number, turn-taking mode, your cooldown

Moderator
- `moderator.force_speaker(seat_id)`
- `moderator.cooldown(seat_id, rounds, reason)`
- `moderator.bypass(seat_id, reason)`
- `moderator.inject()`

## Permissions

- All Host API access gated by an MCP token issued at `attach`.
- Token is scoped to `(session, seat)`.
- Token claims encode which tools that seat may call.
- Moderator tools require a `moderator` claim — no special channel, just a permission.
- Same model scales to future per-persona tool allowlists (`web_search`, `code_execute`, etc.).

## Runtimes (v1)

Three adapters. Operationally similar; differences below.

### Anthropic Managed Agents

- *attach* — ensure Agent definition exists (built from persona spec); open new Session against it; register Host API endpoint as one of the Session's MCP servers; handle = Session ID
- *takeTurn* — POST user event to the Session containing new events + "your turn" framing; yield SSE text deltas
- *buzzCheck* — same mechanism; user event = buzz-check prompt instructing agent to call `buzzer.press` or `buzzer.pass`; MCP handler captures the call and resolves
- *detach* — archive the Session
- Notes: server-side state; billing accrues only while running; idle is free

### Claude Code

- *attach* — slash command in a user's Claude Code session (`/ensemble cast <persona>`) connects Host API as an MCP server and primes the session with persona spec + scenario; handle = session ID
- *takeTurn* — feed new events into the session; yield streamed output
- *buzzCheck* — buzz-check prompt; agent calls `buzzer.press` / `buzzer.pass` via MCP
- *detach* — end the slash-command session
- Notes: enables a user joining a running session as one seat from their own Claude Code; orchestrator doesn't know

### Human (UI)

- The first-player adapter. If a session has a human seat, the UI shows the seat and its input affordances.
- *attach* — bind the seat to the UI input bridge
- *takeTurn* — focus the textarea for this seat; stream typed characters live as the human types; resolve on submit. Other personas see characters appearing in real time, same as any other persona.
- *buzzCheck* — capability not declared. UI surfaces a "buzz in" button that calls `buzzer.press` directly on the Host API, bypassing the SPI.
- *detach* — clear the UI binding
- Notes: humans aren't symmetrical with model runtimes for programmatic operations (no buzz_check), but they are symmetrical for user-visible streaming and tool use (via UI buttons that call the same Host API tools)

## Why this design

- Runtimes own the chat loop, tool dispatch, streaming, conversation state. Ensemble doesn't reimplement any of it.
- Memory lives on Ensemble's side: portable across runtime swaps, inspectable from the UI, independent of any runtime's memory features.
- Streaming = `AsyncIterable<string>`. No framing, no protocol overhead.
- Buzzer / memory / moderator extensions are tools, not protocol primitives. Reuses each runtime's existing tool-use machinery.
- Permissions = MCP token claims. One model for everything privileged.
