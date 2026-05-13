# `/ensemble cast` — Claude Code slash command

Join an Ensemble multi-persona session as one seat from inside your own
running Claude Code session. The command tells Claude Code to connect
Ensemble's per-session MCP server, primes the conversation with the
named persona's spec and the session's scenario, and then waits for
the scheduler to drive turns.

## What it does

When you run `/ensemble cast keith https://ensemble.example.com/join/abc123`:

1. Claude Code resolves the persona spec named `keith` (from its
   on-disk persona library, the workspace, or a synthesised default).
2. The slash command opens the Ensemble session URL, which returns an
   MCP server URL plus a scoped bearer token good for one seat in one
   session.
3. Claude Code registers that MCP server. The Host API tools
   (`buzzer.*`, `memory.*`, `cast.list`, `round.info`) become callable
   from the active session.
4. The session is primed with the persona's system prompt, the
   scenario, and a short framing note telling Claude that turns will
   arrive as user messages and that buzz-checks must be answered via
   the `buzzer.press` or `buzzer.pass` tool, echoing the supplied
   nonce.
5. From here, the Ensemble scheduler drives the session via the SPI.
   Your Claude Code session is one seat; the user sees streamed
   responses in the Ensemble web UI just like any other runtime.

## Install

The manifest lives at `apps/server/src/mcp/slash-command/manifest.json`.
Drop it into your Claude Code slash-command directory (the exact path
depends on your Claude Code version; see Claude Code's own docs for
where it scans for command manifests). The manifest is plain JSON; no
build step is required.

## Use

```
/ensemble cast <persona> [session_url] [seat]
```

- `persona` — required. Persona ID or path to a spec file.
- `session_url` — optional. If omitted, the command prompts for the URL
  and validates it before connecting.
- `seat` — optional override for the seat slot.

## Status

The v1 path is **mocked**. The `ClaudeCodeRuntime` on the server side
runs against a `MockMcpTransport` for tests, and is registered only
when `CLAUDE_CODE_RUNTIME_ENABLED=true`. A live `LocalCliTransport`
exists as a typed seam (and is the sole owner of subprocess primitives
in this part of the codebase, enforced by `no-cli-leakage.test.ts`),
but its `open` / `send` methods throw until the Claude Code CLI
publishes a stable scriptable mode suitable for SPI-driven turn
exchanges.

For v1, treat the slash command as the user-facing contract for the
post-v1.5 wiring. Today you can stand the runtime up against the mock
transport to exercise scheduler integration end-to-end.

## Permissions

The MCP token issued in the session URL is scoped to
`(session, seat)`. It carries claims for the Host API tools the
persona's `tools_allowed` includes, plus the `buzzer.*` and the
read-only metadata tools (`cast.list`, `round.info`). Moderator
claims are only issued to seats explicitly cast as moderator. If you
try to call a tool you don't have a claim for, the MCP server
responds with a typed permission error.

## Troubleshooting

- **`RuntimeDisabledError: Claude Code runtime is not configured`** —
  the server-side flag is off. Set `CLAUDE_CODE_RUNTIME_ENABLED=true`.
- **Buzz-check times out** — confirm that your persona's system prompt
  actually instructs Claude to call `buzzer.press` / `buzzer.pass`
  with the nonce echoed back. The runtime's prompt format includes
  this; if you override the prompt template, keep the nonce echo.
- **`LocalCliTransport: live wiring is a v1.5 deliverable`** — you're
  trying to use the live path. Use the mock transport for now and
  follow the v1.5 milestone.
