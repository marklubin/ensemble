# @ensemble/channel-bridge

Tiny MCP server that bridges a Claude Code session into an Ensemble
session as one seat. Speaks the Claude Code **channels** protocol
(`notifications/claude/channel`) to Claude and a thin WebSocket
protocol to Ensemble.

## How it fits

```
Ensemble server          channel-bridge          Claude Code
(Bun + Hono + ws)  <───>  (this binary)  <───>   (host MCP runtime)
        ^                       ^                       ^
        |                       |                       |
   ws://.../channels/ws    stdio MCP                channels API
```

- Ensemble pushes `turn-prompt` frames over the WS.
- The bridge translates them into `notifications/claude/channel` MCP
  notifications for the running Claude Code session.
- The persona's agent in Claude calls the bridge's `reply` tool with
  `{ turn_id, content, done }`. The bridge forwards each call as a
  `reply` frame back over the WS to Ensemble.

The bridge has **no** business logic. It is pure transport.

## Setup

1. Start the Ensemble server with the channels route enabled:
   ```bash
   CLAUDE_CODE_RUNTIME_ENABLED=true \
   CLAUDE_CODE_TRANSPORT=channel \
   ENSEMBLE_CHANNEL_TOKEN=devtoken \
   bun --filter @ensemble/server dev
   ```
   The WS endpoint comes up at `ws://localhost:4111/channels/ws`.

2. Add the bridge to your user MCP config (`~/.mcp.json` or whichever
   one Claude Code is reading):
   ```json
   {
     "mcpServers": {
       "ensemble": {
         "command": "bunx",
         "args": ["@ensemble/channel-bridge"],
         "env": {
           "ENSEMBLE_WS_URL": "ws://localhost:4111/channels/ws",
           "ENSEMBLE_CHANNEL_TOKEN": "devtoken",
           "ENSEMBLE_SESSION_ID": "<your-session-id>",
           "ENSEMBLE_SEAT_ID": "<seat-this-claude-is-playing>"
         }
       }
     }
   }
   ```

3. Launch Claude Code with the channel loaded:
   ```bash
   claude --dangerously-load-development-channels server:ensemble
   ```

4. Create an Ensemble session whose seat at `ENSEMBLE_SEAT_ID` uses
   the `claude-code` runtime. The first turn will route through your
   Claude session.

## Env

| Var                       | Required | Default                              |
| ------------------------- | -------- | ------------------------------------ |
| `ENSEMBLE_WS_URL`         | no       | `ws://localhost:4111/channels/ws`    |
| `ENSEMBLE_CHANNEL_TOKEN`  | no       | (empty — see server policy)          |
| `ENSEMBLE_SESSION_ID`     | yes      | —                                    |
| `ENSEMBLE_SEAT_ID`        | yes      | —                                    |

## Wire protocol

JSON frames over the WS:

bridge → server:
```
{ "type": "register", "session_id": "...", "seat_id": "...", "token": "..." }
{ "type": "reply",    "turn_id": "...", "content": "...", "done": true }
```

server → bridge:
```
{ "type": "registered",  "session_id": "...", "seat_id": "..." }
{ "type": "turn-prompt", "turn_id": "...", "prompt": "...", "meta": { ... } }
{ "type": "superseded",  "session_id": "...", "seat_id": "..." }
{ "type": "unregister",  "reason": "..." }
{ "type": "error",       "message": "..." }
```

## Verifying locally

You don't need a real Claude session to verify the bridge wires up:

```bash
# Boot the server
CLAUDE_CODE_RUNTIME_ENABLED=true bun --filter @ensemble/server dev

# In another shell — point at the dev WS endpoint with a fake bridge
ENSEMBLE_SESSION_ID=s1 ENSEMBLE_SEAT_ID=seat-a \
  ENSEMBLE_WS_URL=ws://localhost:4111/channels/ws \
  bun apps/channel-bridge/src/index.ts
```

The bridge writes status lines to stderr — look for `registered seat=...`.
