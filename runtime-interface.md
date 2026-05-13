# Ensemble — Runtime Interface (SPI + API)

<!-- updated: 2026-05-12 -->

> Supersedes `actor-protocol.md`. The original was at the wrong level —
> it reinvented chat-loop / tool-loop / memory primitives that existing
> agent runtimes already provide. This doc keeps the layering and the
> mechanics, but replaces the protocol with a thin TypeScript interface
> and an MCP-served tool API.

## Premise

Ensemble does **not** build chat loops, tool loops, or memory plumbing.
It uses existing agent runtimes (Anthropic Managed Agents, Claude Code,
Letta, a human at a keyboard, future ones) and acts as the scheduler,
transport, and UI on top.

Two interfaces govern that boundary:

- **SPI** (Service Provider Interface) — what a runtime *implements*.
  Ensemble calls into this. Four required methods, capability flags.
- **API** — what Ensemble *offers* to whatever's running inside the
  runtime. Surfaced as **MCP tools** served per-session. The buzzer,
  memory tools, cast info live here.

Two thin interfaces. Two directions.

```
                        ┌──────────────────────────────┐
                        │ Ensemble Session Server      │
                        │ (TypeScript / Bun / Hono)    │
                        └──────┬─────────────────┬─────┘
                               │                 │
                       SPI ────┤                 ├──── API (served as MCP)
                  (Ensemble calls)         (runtime/agent calls)
                               │                 │
            ┌──────────────────┴───┐         ┌───┴────────────────────┐
            │ PersonaRuntime impls  │         │ Tools                  │
            │  ManagedAgentsRuntime │         │  buzzer.press / pass   │
            │  ClaudeCodeRuntime    │         │  memory.{r,w,list}     │
            │  LettaRuntime         │         │  cast.list             │
            │  HumanRuntime         │         │  round.info            │
            └───────────────────────┘         │  moderator.*  (priv.)  │
                                              └────────────────────────┘
```

---

## Stack

- **Language**: TypeScript
- **Runtime**: Bun
- **Schema / validation**: Zod everywhere
- **HTTP**: Hono on Bun
- **Transport to UI**: SSE for streaming turns; standard REST for everything else
- **Transport to runtimes**: native per-adapter (Anthropic SDK, MCP, Letta SDK, in-process for Human)
- **MCP server**: Ensemble exposes a per-session MCP endpoint serving the API tools

---

## The SPI

What a runtime adapter implements. ~4 required methods, capability set, optional methods gated by capabilities.

### Schemas

```ts
import { z } from "zod";

export const PersonaSpec = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  role: z.string().optional(),                    // "Pro" | "Con" | "Host" | custom
  voice_signature: z.string().optional(),
  buzz_in_policy: z.string().optional(),          // natural-language meta-rule
  tools_allowed: z.array(z.string()).default([]),
  memory_policy: z
    .enum(["ephemeral", "session-scoped", "persistent"])
    .default("ephemeral"),
});
export type PersonaSpec = z.infer<typeof PersonaSpec>;

export const SeatInfo = z.object({
  seat_id: z.string(),
  persona_name: z.string(),
  role: z.string().optional(),
});

export const SessionContext = z.object({
  session_id: z.string(),
  seat_id: z.string(),
  scenario: z.string(),
  scenario_format: z.enum(["motion", "question", "scenario", "document", "open"]),
  cast: z.array(SeatInfo),
  ensemble_mcp_url: z.string().url(),             // where the runtime can reach API tools
  ensemble_mcp_token: z.string(),                 // scoped to (session, seat)
});
export type SessionContext = z.infer<typeof SessionContext>;

export const TurnEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("turn"),
    seat_id: z.string(),
    speaker: z.string(),
    content: z.string(),
    round: z.number().int(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("moderator"),
    content: z.string(),
    round: z.number().int(),
    tool_calls: z.array(z.object({ tool: z.string(), args: z.unknown(), result: z.unknown() })).optional(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("scenario_change"),
    new_prompt: z.string(),
    round: z.number().int(),
  }),
  z.object({
    kind: z.literal("cooldown"),
    seat_id: z.string(),
    rounds: z.number().int(),
    reason: z.string(),
  }),
]);
export type TurnEvent = z.infer<typeof TurnEvent>;

export const BuzzResponse = z.object({
  score: z.number().min(0).max(10),
  intent: z.string(),
  can_pass: z.boolean().default(true),
});
export type BuzzResponse = z.infer<typeof BuzzResponse>;

export const Capability = z.enum([
  "streaming",            // produces AsyncIterable<string> for turns
  "buzz_check",           // can answer buzz polls (poll mode requires this)
  "tools",                // honors tools_allowed and calls them via runtime
  "mcp",                  // can connect to Ensemble's MCP server natively
  "memory_inspection",    // exposes the persona's memory to Ensemble
  "pause_resume",         // can be paused and resumed cheaply
]);
export type Capability = z.infer<typeof Capability>;
```

### The interface

```ts
export interface InstanceHandle {
  readonly id: string;
  readonly seat_id: string;
  readonly capabilities: ReadonlySet<Capability>;
}

export interface PersonaRuntime {
  readonly name: string;                           // "managed-agents" | "claude-code" | ...
  readonly defaultCapabilities: ReadonlySet<Capability>;

  /** Provision an instance for this persona in this session. */
  attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle>;

  /**
   * Take a turn. `newEvents` are events the runtime hasn't seen yet
   * (the runtime is expected to hold its own conversation state).
   * Yields response chunks as they stream from the underlying runtime.
   */
  takeTurn(
    handle: InstanceHandle,
    newEvents: TurnEvent[],
  ): AsyncIterable<string>;

  /**
   * Poll-mode self-select. Asks the persona "do you want to speak?"
   * Returns score + one-sentence intent. Required if the session
   * uses `poll` turn-taking mode (gated by `buzz_check` capability).
   */
  buzzCheck(
    handle: InstanceHandle,
    recentTurns: TurnEvent[],
  ): Promise<BuzzResponse>;

  /** Clean up the instance. */
  detach(handle: InstanceHandle): Promise<void>;

  // ── Optional, capability-gated ────────────────────────────────────

  /** Inspect the persona's runtime-held memory. Requires `memory_inspection`. */
  inspectMemory?(handle: InstanceHandle): Promise<Record<string, unknown>>;

  /** Pause an idle instance (for cost or container lifecycle). */
  pause?(handle: InstanceHandle): Promise<void>;
  resume?(handle: InstanceHandle): Promise<void>;
}
```

The session scheduler holds one `InstanceHandle` per seat, calls `takeTurn` when it's a seat's turn, and `buzzCheck` in poll mode. The runtime *is* the chat loop — the adapter just bridges between this interface and the runtime's native API.

---

## The API (MCP tools served by Ensemble)

Ensemble runs a per-session MCP server. Each persona instance's runtime is given the MCP URL + a scoped token in `SessionContext.ensemble_mcp_url`. The persona's agent can call these tools from inside its own loop — no special protocol on top.

This is the elegant move: **buzz-in, memory ops, and pass aren't wire-protocol primitives any more. They're tools the agent calls naturally**, like it would any other tool.

### v1 tool surface

```ts
import { z } from "zod";

export const tools = {
  // ─── Turn signaling ──────────────────────────────────────────────
  "buzzer.press": {
    description:
      "Signal you want to speak next. Used during buzz-check polling, " +
      "or out-of-turn to request an interjection. Score 0-10.",
    input: z.object({
      intensity: z.number().min(0).max(10),
      intent: z.string().describe("one sentence: what you'd contribute"),
    }),
  },
  "buzzer.pass": {
    description: "Decline this turn entirely. You're skipped this round.",
    input: z.object({ reason: z.string().optional() }),
  },

  // ─── Memory (session-scoped) ─────────────────────────────────────
  "memory.write": {
    description: "Persist a key/value to your session-scoped memory.",
    input: z.object({ key: z.string(), value: z.unknown() }),
  },
  "memory.read": {
    description: "Read a key from your session-scoped memory.",
    input: z.object({ key: z.string() }),
  },
  "memory.list": {
    description: "List keys in your session-scoped memory.",
    input: z.object({}),
  },

  // ─── Session metadata ────────────────────────────────────────────
  "cast.list": {
    description: "List the cast in this session with roles.",
    input: z.object({}),
  },
  "round.info": {
    description:
      "Get current round metadata: round number, turn-taking mode, " +
      "your current cooldown if any.",
    input: z.object({}),
  },

  // ─── Moderator-only (privileged) ─────────────────────────────────
  "moderator.force_speaker": {
    description: "(Moderator only) Force a seat to speak next regardless of mode.",
    input: z.object({ seat_id: z.string() }),
  },
  "moderator.cooldown": {
    description: "(Moderator only) Put a seat on cooldown for N rounds.",
    input: z.object({ seat_id: z.string(), rounds: z.number().int().min(1), reason: z.string() }),
  },
  "moderator.bypass": {
    description: "(Moderator only) Skip a seat this round.",
    input: z.object({ seat_id: z.string(), reason: z.string() }),
  },
  "moderator.inject": {
    description: "(Moderator only) Speak now, ahead of the queue.",
    input: z.object({}),
  },
};
```

Privileged moderator tools are scoped at token-issuance time — the MCP token for a moderator seat includes the `moderator` claim; tokens for cast seats don't. Server-side validation rejects misuse cleanly.

### Why this is the right shape

- **Native to every agent runtime that speaks MCP.** Managed Agents, Claude Code, Letta, and the OpenAI Agents SDK all support remote MCP servers. The agent in its own loop discovers and calls these tools as if they were any other tool. No custom message routing.
- **The buzzer becomes a real tool.** A persona's `buzz_in_policy` is just guidance for *when to call the buzzer tool*. The system prompt naturally includes: *"During buzz-check moments, decide based on your policy and call `buzzer.press` or `buzzer.pass`."*
- **Memory inspection from outside is free.** Ensemble owns the memory store; the MCP server is just a thin facade. The UI can read the same store directly.
- **Moderator extensions don't need a protocol — they're tools.** `moderator.force_speaker` is just a tool the moderator persona can call. The system prompt for the moderator says "you can force a speaker if the conversation needs steering."

---

## Worked examples

### ManagedAgentsRuntime (primary v1 adapter)

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { PersonaRuntime, InstanceHandle, PersonaSpec, SessionContext, TurnEvent, BuzzResponse } from "./spi";

export class ManagedAgentsRuntime implements PersonaRuntime {
  readonly name = "managed-agents";
  readonly defaultCapabilities = new Set([
    "streaming", "buzz_check", "tools", "mcp", "pause_resume",
  ] as const);

  constructor(private client: Anthropic, private modelId: string) {}

  async attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    // Create or reuse an Agent definition, then open a fresh Session.
    const agent = await this.ensureAgentDefinition(persona, ctx);
    const session = await this.client.beta.managedAgents.sessions.create({
      agent_id: agent.id,
      mcp_servers: [{ url: ctx.ensemble_mcp_url, auth_token: ctx.ensemble_mcp_token }],
      metadata: { ensemble_session: ctx.session_id, seat: ctx.seat_id },
    });
    return {
      id: session.id,
      seat_id: ctx.seat_id,
      capabilities: this.defaultCapabilities,
    };
  }

  async *takeTurn(handle: InstanceHandle, newEvents: TurnEvent[]): AsyncIterable<string> {
    const userMessage = formatEventsAsTurnPrompt(newEvents);
    const stream = this.client.beta.managedAgents.sessions.events.create({
      session_id: handle.id,
      role: "user",
      content: userMessage,
      stream: true,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }

  async buzzCheck(handle: InstanceHandle, recentTurns: TurnEvent[]): Promise<BuzzResponse> {
    // Send a buzz-check event. The persona's agent will call buzzer.press
    // or buzzer.pass via MCP. Ensemble's MCP handler captures the call
    // and resolves this promise.
    const prompt = formatBuzzCheckPrompt(recentTurns);
    const result = await this.runAndCaptureBuzz(handle.id, prompt);
    return result;
  }

  async detach(handle: InstanceHandle): Promise<void> {
    await this.client.beta.managedAgents.sessions.archive({ session_id: handle.id });
  }

  private async ensureAgentDefinition(persona: PersonaSpec, ctx: SessionContext) { /* ... */ }
  private async runAndCaptureBuzz(sessionId: string, prompt: string): Promise<BuzzResponse> { /* ... */ }
}
```

### HumanRuntime

```ts
export class HumanRuntime implements PersonaRuntime {
  readonly name = "human";
  readonly defaultCapabilities = new Set(["streaming"] as const);
  // No `buzz_check` capability — a human in poll mode is handled
  // by the UI showing a "buzz in?" button rather than the protocol.

  constructor(private uiBridge: UiBridge) {}

  async attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    return {
      id: crypto.randomUUID(),
      seat_id: ctx.seat_id,
      capabilities: this.defaultCapabilities,
    };
  }

  async *takeTurn(handle: InstanceHandle, _events: TurnEvent[]): AsyncIterable<string> {
    // Focus the UI textarea for this seat. Stream typed characters
    // as they're entered. Resolve on submit.
    yield* this.uiBridge.streamHumanInput(handle.seat_id);
  }

  async buzzCheck(): Promise<BuzzResponse> {
    // Humans don't buzz programmatically. The UI may surface a button
    // that fires `buzzer.press` directly on Ensemble's MCP endpoint.
    return { score: 0, intent: "", can_pass: true };
  }

  async detach(): Promise<void> { /* nothing to clean */ }
}
```

### ClaudeCodeRuntime (sketch — not v1)

```ts
export class ClaudeCodeRuntime implements PersonaRuntime {
  readonly name = "claude-code";
  readonly defaultCapabilities = new Set([
    "streaming", "buzz_check", "tools", "mcp",
  ] as const);

  async attach(persona: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    // Open a slash-command channel to a Claude Code session. The
    // session connects Ensemble as an MCP server and receives the
    // persona spec + scenario as its first prompt.
    const handle = await this.openSession(persona, ctx);
    return { id: handle, seat_id: ctx.seat_id, capabilities: this.defaultCapabilities };
  }

  async *takeTurn(handle: InstanceHandle, newEvents: TurnEvent[]): AsyncIterable<string> {
    // Pipe a turn prompt into the Claude Code session; yield streamed
    // output from its stdout (or a side-channel SSE).
    yield* this.streamClaudeOutput(handle.id, formatEventsAsTurnPrompt(newEvents));
  }

  // ...
}
```

---

## How the scheduler uses all this

The scheduler is a state machine that owns the session and calls into the SPI:

```ts
class SessionScheduler {
  constructor(
    private session: Session,                       // cast, scenario, mode
    private runtimes: Map<string, PersonaRuntime>,  // seat_id -> runtime
  ) {}

  async runRound() {
    const order = this.pickOrder();   // depends on session.turn_taking_mode
    for (const seat_id of order) {
      const runtime = this.runtimes.get(seat_id)!;
      const handle = this.session.handleFor(seat_id);
      const newEvents = this.session.unseenEventsFor(seat_id);

      const stream = runtime.takeTurn(handle, newEvents);
      const fullText = await this.streamToTranscript(seat_id, stream);

      this.session.recordTurn(seat_id, fullText);
    }
  }

  private async pickOrder(): Promise<string[]> {
    if (this.session.mode === "poll") {
      // Buzz-check every idle, non-cooldown seat in parallel
      const polls = [...this.idleSeats()].map(async (seat) => {
        const runtime = this.runtimes.get(seat)!;
        if (!runtime.defaultCapabilities.has("buzz_check")) return null;
        const r = await runtime.buzzCheck(this.session.handleFor(seat), this.session.recentTurns(3));
        return { seat, ...r };
      });
      const results = (await Promise.all(polls)).filter(Boolean);
      // Apply quiet bias, sort by score, top wins
      return [pickWinner(results)];
    }
    // ... round-robin / shuffled / host-driven
  }
}
```

The scheduler never knows what's behind a runtime. The MCP server runs alongside and handles `buzzer.*` / `memory.*` / `cast.list` / `moderator.*` calls from inside each runtime's loop.

---

## v1 implementation scope

**Ship in v1:**
- SPI as defined above
- API as defined above, served per-session over MCP
- `ManagedAgentsRuntime` adapter (primary)
- `HumanRuntime` adapter
- Turn-taking modes: `round-robin`, `shuffled`, `host-driven`, `poll`
- Cooldowns (poll mode)
- Session-scoped memory (server-side store, exposed via `memory.*` MCP tools)
- Moderator privileges (`force_speaker`, `cooldown`, `bypass`, `inject`)
- Screenplay UI consuming a single SSE event stream from the scheduler

**Defer:**
- `ClaudeCodeRuntime`, `LettaRuntime`, `OpenAIChatRuntime`
- Persistent memory policy (across user-sessions)
- `inspectMemory` capability (UI panel for editing persona memory live)
- Interruption / hybrid turn-taking
- Cross-runtime sessions exercised end-to-end (interface supports it; we don't ship two adapters initially)

---

## Open questions

1. **MCP token scoping.** The token issued to each runtime grants access to that seat's API tools. Should the token additionally constrain which *other seats'* metadata it can see (`cast.list` returns all, but `memory.read` is scoped to self)? Probably yes — seat-scoped by default, moderator-scoped tokens broader.
2. **Buzz-check via MCP tool vs. dedicated method.** Currently the SPI has `buzzCheck` as a method, but the persona answers by calling `buzzer.press`/`pass` MCP tools. Should `buzzCheck` even exist on the SPI, or should the scheduler just send a "you're being asked to buzz" event and wait for the tool call? *Probably the latter — drop `buzzCheck` from the SPI, fold it into events + tool calls.*
3. **Cold-start cost.** Managed Agents Sessions provision containers; latency unknown. May want to pre-warm one Session per cast member at session start and keep them idle until needed.
4. **Memory namespace.** Is memory scoped `(seat_id, session_id)` or `(persona_id, session_id)`? If the same persona is double-cast (two Keiths in one session?), the former. If two sessions share Keith's memory, the latter. Probably `(persona_id × session_id × seat_id)` triple, with explicit "share with persona globally" as a separate write.
5. **Hono vs. raw Bun.** Hono is convenient but adds a dep. Bun has a fine native HTTP API. For an MCP server, probably worth Hono for the routing ergonomics. Confirm before starting.
6. **MCP server library.** Anthropic's TypeScript MCP SDK or roll our own? Likely use Anthropic's `@modelcontextprotocol/sdk` — they're maintaining it.

---

## What this replaces

`actor-protocol.md` (v0.1) defined a custom WebSocket protocol with granular messages like `actor.chunk` / `actor.tool_call` / `actor.memory_op`. That was the wrong altitude — every adapter would have had to reimplement chat-loop / tool-loop / memory plumbing. This doc replaces it. Layering and mechanics survive; the protocol is gone.
