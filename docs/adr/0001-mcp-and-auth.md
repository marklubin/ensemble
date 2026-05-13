# ADR 0001 — MCP server, scoped JWT, buzzer nonce, sqlite memory

**Status:** accepted (Phase 1 — Agent B)
**Date:** 2026-05-13

## Context

Ensemble exposes the Host API as MCP tools (`buzzer.*`, `memory.*`,
`cast.list`, `round.info`, `moderator.*`). The MCP server is invoked
from inside agent runtimes (Managed Agents, Claude Code, the human UI
bridge, etc.). Two seats sharing a session each need their own scoped
view, and moderator powers must be gated server-side.

## Decisions

### 1. JWT (HS256) for scoped tokens

We mint a short-lived JWT per `(session_id, seat_id)` at session start.
The token's payload carries the session/seat identifiers and a
`claims` array (today: presence/absence of `"moderator"`; tomorrow:
per-tool allowlists like `"web_search"`).

**Alternatives considered:**

- *Session cookies.* Cross-process flow into a managed-agent runtime
  has no cookie jar; the agent passes the token as an HTTP
  `Authorization` header on its MCP calls.
- *Opaque API keys + server-side lookup table.* Adds a database
  round-trip on every tool call; gains nothing the JWT doesn't already
  give us at scale.
- *RS256.* Requires key distribution. HS256 is fine because the MCP
  server and the issuer live in the same process.

The token is the only thing the runtime carries — the URL is a single
`/mcp/rpc` endpoint; session identity rides in the token. This
collapses the per-session-URL trick into a per-session-token trick,
which is easier to revoke and easier to test.

We deliberately do *not* hide moderator tools from non-moderator token
holders. They show up in the tool list, but the handler returns
`{error:"FORBIDDEN"}` if called. This matches
`architecture.md`: *"Server-side validation rejects misuse cleanly."*

### 2. Buzzer nonce via prompt-echo

A runtime polls `BuzzCoordinator.wait({session_id, seat_id, nonce})`.
When the persona's agent calls `buzzer.press` or `buzzer.pass`, the
handler resolves the matching waiter — *but* the MCP tool input
schemas live in `@ensemble/shared`, which is frozen for Phase 1.

We support two transports for the nonce without touching shared:

1. **Embed in `intent`/`reason` strings** as `"... #nonce:<value>"`.
   The runtime's buzz-check prompt asks the agent to include the
   suffix. Default approach for v1 and what tests cover today.
2. **Top-level `nonce` field** on the tool args. If a future schema
   revision allows the extra field, the handler picks it up
   transparently. (Currently the SDK strips unknown fields via Zod
   `.shape` normalization, so #1 is the working path.)

Either transport routes to the same coordinator — nonce-on-payload
extension is HANDOFF.md material for the orchestrator.

### 3. Sqlite for memory persistence — but in-memory by default

The `IMemoryStore` interface is keyed by `(session_id, seat_id, key)`.
Two implementations live behind the same surface:

- **`MemoryStore`** (default): single `Map` of `Map`s. Wins on test
  speed, zero deps, identical semantics.
- **`SqliteMemoryStore`**: `bun:sqlite`, one table `memory_entries`
  with `(session_id, seat_id, key)` as the composite primary key.
  Values stored as JSON strings.

`MEMORY_BACKEND=in-memory|sqlite` selects at boot. The COMMON.md
pre-authorized fallback lets us ship in-memory as default until we
load-test sqlite; the sqlite path is implemented and tested under
`:memory:` so the swap is one env var.

**Why sqlite, not Postgres?** A session's memory is small,
short-lived, and inspected by the UI in the same process. The cost of
a server-grade DB outweighs the durability win. If we need
cross-process durability later, the same `IMemoryStore` surface lets
us swap.

### 4. Stateless HTTP transport

`WebStandardStreamableHTTPServerTransport` is configured with
`sessionIdGenerator: undefined`. The JWT carries everything we need —
sessions on the MCP layer would be a second source of truth. Stateless
also means the MCP server tolerates restarts without per-connection
state.

## Consequences

- One endpoint (`/mcp/rpc`) per server, gated by JWT bearer auth.
- A leaked moderator token grants moderator powers until the token's
  `exp`. Short TTLs + reissue at scheduler boundaries are the
  mitigations.
- Sqlite writes are synchronous (bun:sqlite is sync). At scale we may
  want to wrap writes in a queue; not needed for v1 (one writer per
  seat, low write volume).
- The nonce echo trick depends on personas following the system
  prompt. If they elide the suffix, the buzz-check times out — a safe
  failure mode (returns `{kind:"timeout"}` to the runtime).

## Open follow-ups (for HANDOFF)

- Promote a `nonce` field onto `BuzzerPressInput` / `BuzzerPassInput`
  in `@ensemble/shared` once shared thaws — drops the string-suffix
  trick.
- Wire `IEventBus` to Agent A's real `event-bus.ts` at orchestrator
  integration.
- Add token revocation list if we observe leaked-token incidents.
