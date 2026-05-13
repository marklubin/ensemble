# Ensemble — Actor Protocol & Runtime Bindings

<!-- updated: 2026-05-12 -->

## Premise

A persona is a **specification**, not an implementation. The same persona
can be played by an OpenAI chat completion, by a local llama.cpp, by a
human typing in a textbox, by a Claude Code session, or by an arbitrary
external agent we haven't built yet. Ensemble is the **session
orchestrator** — it brokers turns between actors over a defined protocol
and doesn't care what's behind the connection.

The image to hold in your head: *"Waiting for Claude to join as player
one."* A casting lobby. Seats fill in as runtimes connect.

---

## The three layers

| Layer | What it is | Lifecycle |
|---|---|---|
| **Persona** | Declarative spec. Name, system prompt, role hint, voice signature, tools allowed, memory policy, buzz-in policy. Lives in your library. | Persistent — same persona usable across sessions. |
| **Actor** | A persona *instantiated for a session*. Binds (Persona × Runtime × Session × Seat). Has memory scoped to its policy. | Per-session — created on casting, destroyed at end (memory may persist depending on policy). |
| **Runtime** | The execution backend that produces the actor's responses. OpenAI chat completions, Anthropic, local LLM, human, Claude Code, external service. | Connected per-actor — may multiplex many actors over one process. |

Critical idea: **the human is just another runtime.** No special case in the protocol. The `HumanRuntime` adapter exposes an input box and streams typed characters as `actor.chunk` events. The session orchestrator can't tell the difference.

Same goes for Claude. A `ClaudeCodeRuntime` adapter briefs a Claude Code session with the persona spec + session context, lets it generate, and streams chunks back. From Ensemble's perspective, Claude is just an actor that happens to be backed by Claude.

---

## The actor protocol

Wire format: **WebSocket + JSON messages** (newline-delimited or as `text` frames). One WebSocket per actor connection. Bi-directional, streaming, low ceremony.

### Why not WebRTC

WebRTC's data channels would work but the value-add (NAT traversal, low-latency media) is irrelevant for text chat. WebSocket is simpler, debuggable in the browser DevTools, and every LLM SDK speaks it natively. We can add WebRTC later if we want voice personas.

### Why not raw MCP

MCP (Model Context Protocol) has the right *vibe* — bidirectional, streaming notifications, tool-call semantics. But MCP is structured client→server with notifications going the other way; the actor protocol is genuinely peer-to-peer. We may converge later. For now we use plain WebSocket with our own message shape and steal MCP's tool-call schema where helpful.

### Connection lifecycle

```
Actor → Session:  actor.hello { persona_id, runtime_type, runtime_version, capabilities }
Session → Actor:  session.brief { session_id, seat_id, persona_spec, cast, scenario, history }
Session → Actor:  session.event* (zero or more, until your turn)
Session → Actor:  session.take_turn { turn_id, context_hint? }
Actor  → Session: actor.chunk { turn_id, delta }*
Actor  → Session: actor.finalize { turn_id, full_text, tools_used }
Session → Actor:  session.event* (other turns happen)
...
Session → Actor:  session.end { transcript_url }
```

`actor.hello` declares what runtime this is and what capabilities it offers (tool use, memory, streaming). The session can decline an actor that doesn't meet template requirements (e.g. "this template requires the actor support `buzz_in`").

### Session → Actor messages

| Message | Payload | When |
|---|---|---|
| `session.brief` | full session setup pinned to your seat | once, on join |
| `session.event` | `{ kind: "turn", speaker, content, round, ... }` | every time something happens you should see |
| `session.take_turn` | `{ turn_id, context_hint? }` | your turn — start streaming |
| `session.buzz_check` | `{ poll_id, recent_turns }` | self-select mode: do you want to speak? |
| `session.cooldown` | `{ rounds: N, reason }` | moderator put you on cooldown |
| `session.bypass` | `{ reason }` | moderator skipped you this round |
| `session.tool_result` | `{ call_id, result }` | response to your tool call |
| `session.memory_synced` | `{ keys: [...] }` | confirmation of a memory write |
| `session.end` | `{ transcript_url, ended_by }` | session is over |

### Actor → Session messages

| Message | Payload | When |
|---|---|---|
| `actor.hello` | `{ persona_id, runtime_type, capabilities }` | connect |
| `actor.chunk` | `{ turn_id, delta, position }` | streaming response tokens |
| `actor.finalize` | `{ turn_id, full_text, tools_used }` | turn complete |
| `actor.buzz_response` | `{ poll_id, score: 0-10, intent: string, can_pass: bool }` | response to buzz_check |
| `actor.tool_call` | `{ call_id, tool, args }` | request tool execution |
| `actor.memory_op` | `{ op: read \| write \| list, key?, value? }` | memory access |
| `actor.error` | `{ kind, message }` | something broke |
| `actor.disconnect` | `{ reason }` | leaving |

### Moderator extensions (privileged)

The moderator is also an actor, but it has additional outbound messages:

| Message | Effect |
|---|---|
| `mod.force_speaker` `{ seat_id }` | next turn goes to that seat regardless of mode |
| `mod.cooldown` `{ seat_id, rounds, reason }` | put a seat on cooldown |
| `mod.bypass` `{ seat_id, reason }` | skip seat this round |
| `mod.inject` `{ turn_id }` | moderator wants to speak right now, ahead of the queue |
| `mod.edit_memory` `{ seat_id, key, value }` | direct memory mutation on another actor |
| `mod.invoke_tool` `{ tool, args }` | call a tool (web_search, etc.) — visible to cast |

Moderator privileges are enforced server-side based on the seat's role and the session's moderation config.

---

## Runtime adapters

A **runtime adapter** is what translates between the actor protocol and a specific execution backend. Adapters are server-side processes (or threads) that hold a WebSocket to the session and an SDK/connection to the backend.

### v1 adapters

| Adapter | Backend | Notes |
|---|---|---|
| `OpenAIChatAdapter` | OpenAI Chat Completions / Responses API | Standard. Builds messages list from `brief` + accumulating `events`. |
| `AnthropicChatAdapter` | Anthropic Messages API | Same shape; uses system prompt slot for persona. |
| `LocalLLMAdapter` | OpenAI-compatible local servers (Ollama, vLLM, llama.cpp) | Same interface as OpenAI adapter, different base URL. |
| `HumanAdapter` | A text box in the Ensemble UI | When `take_turn` arrives, focus the input. Stream typed characters as `chunk`. `finalize` on submit. |
| `ClaudeCodeAdapter` | A Claude Code subagent | Brief becomes the prompt; subagent output streams back. *(stretch — see below)* |

### The Claude Code adapter — the killer demo

The user opens a Claude Code session, runs `/ensemble join <session_url> as <persona_id>`, and Claude Code connects as that persona. Each `take_turn` fires off a focused subagent call (or a turn-scoped Claude call) with the persona prompt + session history; the subagent's streaming output becomes `chunk` events.

This means **Claude can join any session as any persona without any code changes to Ensemble itself**. Persona is decoupled from runtime.

Two implementations to weigh:
1. **Slash command + MCP server.** Ensemble exposes an MCP server. Claude Code adds it as an MCP. `/ensemble join` calls a tool that opens the WebSocket and starts servicing `take_turn` events. Pro: standardized. Con: MCP's client→server bias makes the bi-directional protocol awkward.
2. **Standalone Node/Python client invoked by Claude Code.** A small binary (`ensemble-actor`) that Claude can run via Bash, given persona_id and session_url. Pro: clean. Con: needs install.

Probably **(1)** for v1 — MCP is becoming the lingua franca.

### Future adapters

- `ExternalAgentAdapter` — generic webhook-based, for arbitrary agent frameworks (LangGraph, CrewAI, AutoGen).
- `RecordedAdapter` — plays back canned responses; useful for testing and demos.
- `VoiceAdapter` — TTS + STT bridge. Personas you can actually talk to.

---

## Turn-taking modes (v1 scope)

User confirmed: ship **four** modes in v1. Drop interruption and hybrid for later.

### round-robin
Fixed order across rounds. Standup-style.

### shuffled
Re-shuffled order each round. Current default in both baselines.

### host-driven
One designated seat (`role: Host`) picks who speaks next. Implementation: after each turn, send the host an extra `session.host_pick` message asking who should go next; their response routes the next `take_turn`.

### poll (self-select with buzz-in)

This is the most interesting one — and the user's preferred next step.

**Mechanic:**
1. After each turn, the speaker enters a **cooldown** for `cooldown_rounds` (default 1).
2. For each idle, non-cooldown seat, the session sends `session.buzz_check` with the last 1–3 turns.
3. Each actor returns `actor.buzz_response` with `{ score: 0-10, intent: <one sentence>, can_pass: bool }`.
4. Highest score wins. Quiet-bias optional. Tie-break random.
5. The winner's `intent` becomes a hint in their subsequent `session.take_turn`.

**The buzz-in policy** — this is the meta-cognitive piece:

Each persona spec includes a `buzz_in_policy` — a short natural-language description of *when this persona wants to speak*. Example:

> "Buzz in when factual claims are being made without evidence, or when someone is conflating routing with retrieval. Stay quiet when the conversation is on strategy or org structure — that's not my area."

This policy is *injected into the buzz_check prompt* so the persona scores itself against its own meta-rules. It's the spec saying, *"here's what playing me well looks like — and here's how to know when to be quiet."*

`can_pass: false` lets a persona signal "I don't have anything useful here, skip me entirely this round."

---

## Memory

Every actor has a memory store. Scope is set by `persona.memory_policy`:

| Policy | Behavior |
|---|---|
| `ephemeral` | Lives during the session, discarded on end. |
| `session-scoped` | Persisted with the session transcript, reloadable if you re-open it. |
| `persistent` | Synced to the persona's global memory across all sessions. |

**Operations**:
- `read(key) → value`
- `write(key, value)`
- `list() → keys[]`

The actor uses `actor.memory_op` for its own reads/writes. The session writes back `session.memory_synced` to confirm. The moderator can use `mod.edit_memory` to mutate any actor's memory (visible audit trail in the transcript).

**UI surface**: each actor's row in the session UI gets a small "memory" affordance (think: a notebook icon) that opens an editable key-value panel. Useful for inspection, debugging, scripting scenarios where you want to seed a persona with prior knowledge.

---

## Tools

Persona spec declares `tools_allowed: [...]`. The session validates each `actor.tool_call` against this allowlist.

**v1**: only the moderator (in its `fact-checker` role) gets `web_search`. Cast personas have `tools_allowed: []`.

**Future**: any persona can declare tools. Examples:
- A researcher persona with `web_search` + `arxiv_search`
- A coder persona with `code_execute` + `read_file`
- A trader persona with `quote_lookup`

Tool execution is session-mediated: the session receives the `actor.tool_call`, invokes the tool, and returns `session.tool_result`. Tools that take time (search) stream interim status via `session.event` (`{ kind: "tool_status", actor, tool, status }`) so the UI can render the "🔍 Searching: ..." indicator like the baseline did.

---

## Connection topology

```
                          ┌──────────────────────┐
                          │ Ensemble Session     │
                          │ Orchestrator (server)│
                          └──────┬───────────────┘
                                 │ WebSocket per actor
            ┌────────────┬───────┼────────┬──────────────┬─────────────────┐
            │            │       │        │              │                 │
       ┌────▼────┐  ┌────▼───┐  ┌▼────┐  ┌▼──────┐  ┌────▼────┐    ┌──────▼──────┐
       │ OpenAI  │  │Anthropic│  │Human │  │Claude │  │ Local   │    │ External    │
       │ Adapter │  │ Adapter │  │      │  │ Code  │  │ LLM     │    │ Agent       │
       └────┬────┘  └────┬───┘  └──────┘  └───┬───┘  └────┬────┘    └──────┬──────┘
            │            │                    │           │                 │
       OpenAI API    Anthropic API        Claude Code    Ollama         arbitrary
                                          (MCP)         /vLLM           webhook
```

The browser UI is itself a WebSocket client — it subscribes to the same event stream as actors do (read-only, plus moderator commands if the user is in a director seat).

---

## v1 implementation scope

**Ship:**
- Persona spec (markdown — same format as the baseline)
- Actor protocol over WebSocket (the message set above, minus moderator extensions for non-mod seats)
- Adapters: `OpenAIChatAdapter`, `AnthropicChatAdapter`, `LocalLLMAdapter`, `HumanAdapter`
- Turn-taking: `round-robin`, `shuffled`, `host-driven`, `poll`
- Cooldowns (in `poll` mode)
- Memory: ephemeral and session-scoped (not persistent yet)
- Tools: moderator-only `web_search`
- Moderator extensions: `inject`, `force_speaker`, `cooldown`, `invoke_tool`

**Defer:**
- `ClaudeCodeAdapter` (great demo, but post-MVP)
- `ExternalAgentAdapter` and webhook-based runtimes
- `persistent` memory policy
- Tools for non-moderator personas
- `mod.edit_memory` (admin power; can come later)
- Interruption mid-stream (turn-taking mode)
- Voice adapter

---

## Open questions

1. **Server-side vs. client-side actors.** Should LLM adapters run server-side (Ensemble process holds API keys, brokers everything) or client-side (browser holds keys, talks direct to OpenAI)? Server-side is simpler ops but you eat the LLM bill. Client-side is BYO-key. *Probably: server-side default, BYO-key as an option.*
2. **Single WebSocket per actor vs. multiplexed.** A single Ensemble process probably hosts many actors over many sessions. One WS per actor is conceptually clean; multiplexing over one WS per backend (one WS for "all OpenAI actors") might scale better. *v1: one WS per actor — keep it simple.*
3. **Buzz-in cost.** For an N-persona session in `poll` mode, that's N small LLM calls between every turn. At 5 personas × 30 turns × $0.001/call ≈ $0.15 of poll overhead per session. Probably fine; flag if it gets painful.
4. **Buzz-in fidelity.** Does the buzz score reflect what the persona actually *would* say, or just whether they want to say something? Probably the former — the persona is rolling a quick lookahead. Worth testing whether the polled `intent` matches the eventual turn.
5. **Memory key namespacing.** If a persona is in two sessions simultaneously with `session-scoped` memory, do those memories collide? *Probably namespace by `(persona_id, session_id)`.*
6. **MCP vs. custom protocol convergence.** Worth a real spike before v1 to see how painful pure-MCP would be. If it's tolerable, we get Claude Code integration for free.
7. **What does "Claude joins as Keith" look like from inside Claude Code?** A slash command? A new top-level command? An invisible MCP that just receives a brief and writes back? — UX design question separate from protocol.

---

## Why this split matters (beyond Ensemble)

The Persona/Actor/Runtime split isn't Ensemble-specific. It's a general way to express *"a configured cognitive role that can be hosted in any execution substrate."* Once you have it:

- The same persona library works across products.
- New runtimes (local models, specialized agents, voice avatars) plug in without rewriting consumers.
- Memory becomes inspectable and editable — a debugging surface, not just an internal blob.
- The human and the model are symmetrically treated, which is the right default for HITL workflows.

Treat Ensemble as the first concrete consumer of this abstraction. If the protocol is clean here, it's reusable.
