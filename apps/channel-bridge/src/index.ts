#!/usr/bin/env bun
/**
 * @ensemble/channel-bridge — the small MCP server that Claude Code
 * launches as a development channel. It bridges:
 *
 *     Ensemble server          channel-bridge          Claude Code
 *     (Hono / Bun, WS)  <───>  (this process)  <───>   (host MCP runtime)
 *
 *   - Connects out to Ensemble over a WebSocket
 *     (ENSEMBLE_WS_URL, default ws://localhost:4111/channels/ws)
 *   - Sends a `register` frame announcing { session_id, seat_id }
 *   - When Ensemble pushes a `turn-prompt` frame, the bridge issues an
 *     MCP `notifications/claude/channel` notification into the running
 *     Claude Code session
 *   - Exposes a `reply` tool. The persona's agent calls this tool with
 *     `{ turn_id, content, done }`; the bridge forwards each call as a
 *     `reply` frame back over the WS to Ensemble
 *   - Reconnects with backoff if the WS drops
 *
 * The bridge owns no business logic. It is a pure transport adapter.
 *
 * Config (env):
 *   ENSEMBLE_WS_URL        ws endpoint (default ws://localhost:4111/channels/ws)
 *   ENSEMBLE_CHANNEL_TOKEN bearer token for the WS (default empty)
 *   ENSEMBLE_SESSION_ID    session this bridge represents (required)
 *   ENSEMBLE_SEAT_ID       seat this bridge represents (required)
 *
 * Launch (user side):
 *   Add to ~/.mcp.json:
 *     { "mcpServers": {
 *         "ensemble": {
 *           "command": "bunx",
 *           "args": ["@ensemble/channel-bridge"],
 *           "env": {
 *             "ENSEMBLE_SESSION_ID": "...",
 *             "ENSEMBLE_SEAT_ID": "...",
 *             "ENSEMBLE_CHANNEL_TOKEN": "..."
 *           }
 *         } } }
 *   Then:
 *     claude --dangerously-load-development-channels server:ensemble
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import { z } from "zod";

// ─── Config ──────────────────────────────────────────────────────────

const WS_URL = process.env["ENSEMBLE_WS_URL"] ?? "ws://localhost:4111/channels/ws";
const CHANNEL_TOKEN = process.env["ENSEMBLE_CHANNEL_TOKEN"] ?? "";
const SESSION_ID = process.env["ENSEMBLE_SESSION_ID"];
const SEAT_ID = process.env["ENSEMBLE_SEAT_ID"];

if (!SESSION_ID || !SEAT_ID) {
  // Don't crash silently — fail fast with a useful message on stderr,
  // which `claude --dangerously-load-development-channels` will surface.
  process.stderr.write(
    "[ensemble-channel-bridge] ENSEMBLE_SESSION_ID and ENSEMBLE_SEAT_ID are required\n",
  );
  process.exit(1);
}

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 15_000;

// ─── MCP server scaffolding ──────────────────────────────────────────

const server = new Server(
  { name: "ensemble-channel-bridge", version: "0.0.1" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
  },
);

// `reply` tool — Claude calls this to forward agent output back over
// the WS to Ensemble. Streaming-friendly: a turn may call `reply`
// many times with `done: false` and finish with `done: true`.
const ReplyArgs = z.object({
  turn_id: z.string(),
  content: z.string(),
  done: z.boolean().optional().default(false),
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Reply to the current Ensemble turn prompt. Call once with `done: true` " +
        "to finish a turn. May be called multiple times with `done: false` to " +
        "stream chunks before the final call.",
      inputSchema: {
        type: "object",
        properties: {
          turn_id: { type: "string", description: "Echo the turn_id from the channel notification." },
          content: { type: "string", description: "The text to send back to Ensemble." },
          done: { type: "boolean", description: "True iff this is the final chunk.", default: false },
        },
        required: ["turn_id", "content"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const args = ReplyArgs.parse(req.params.arguments ?? {});
  forwardReply(args.turn_id, args.content, args.done);
  return {
    content: [{ type: "text", text: args.done ? "reply: done" : "reply: chunk" }],
  };
});

// ─── WebSocket client ────────────────────────────────────────────────

let ws: WebSocket | null = null;
let registered = false;
let reconnectMs = RECONNECT_INITIAL_MS;
let shuttingDown = false;

function buildWsUrl(): string {
  const base = WS_URL;
  if (!CHANNEL_TOKEN) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(CHANNEL_TOKEN)}`;
}

function forwardReply(turnId: string, content: string, done: boolean): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    process.stderr.write(
      `[ensemble-channel-bridge] dropping reply (ws not open): turn_id=${turnId}\n`,
    );
    return;
  }
  ws.send(
    JSON.stringify({ type: "reply", turn_id: turnId, content, done }),
  );
}

function handleServerFrame(payload: string): void {
  let msg: any;
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  switch (msg.type) {
    case "registered":
      registered = true;
      reconnectMs = RECONNECT_INITIAL_MS;
      process.stderr.write(
        `[ensemble-channel-bridge] registered seat=${msg.seat_id} session=${msg.session_id}\n`,
      );
      return;
    case "turn-prompt":
      pushPromptIntoClaude(msg.turn_id, msg.prompt, msg.meta ?? {});
      return;
    case "superseded":
      process.stderr.write(
        `[ensemble-channel-bridge] superseded by newer registration; exiting\n`,
      );
      shuttingDown = true;
      ws?.close();
      process.exit(0);
      return;
    case "unregister":
      process.stderr.write(
        `[ensemble-channel-bridge] server requested unregister (${msg.reason}); exiting\n`,
      );
      shuttingDown = true;
      ws?.close();
      process.exit(0);
      return;
    case "error":
      process.stderr.write(`[ensemble-channel-bridge] server error: ${msg.message}\n`);
      return;
  }
}

function pushPromptIntoClaude(
  turnId: string,
  prompt: string,
  meta: Record<string, unknown>,
): void {
  // Push the prompt into the running Claude Code session via an MCP
  // notification. The host runtime is listening on this notification
  // method per the channel spec.
  void server.notification({
    method: "notifications/claude/channel",
    params: {
      content: prompt,
      meta: { ...meta, turn_id: turnId },
    },
  } as any);
}

function connectWs(): void {
  if (shuttingDown) return;
  registered = false;
  const url = buildWsUrl();
  const socket = new WebSocket(url, {
    headers: CHANNEL_TOKEN
      ? { authorization: `Bearer ${CHANNEL_TOKEN}` }
      : {},
  });
  ws = socket;

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "register",
        session_id: SESSION_ID,
        seat_id: SEAT_ID,
        token: CHANNEL_TOKEN,
      }),
    );
  });
  socket.on("message", (data) => {
    handleServerFrame(data.toString());
  });
  socket.on("close", () => {
    if (shuttingDown) return;
    process.stderr.write(
      `[ensemble-channel-bridge] ws closed; reconnecting in ${reconnectMs}ms\n`,
    );
    setTimeout(connectWs, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  });
  socket.on("error", (err) => {
    process.stderr.write(`[ensemble-channel-bridge] ws error: ${(err as Error).message}\n`);
  });
}

// ─── Boot ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  connectWs();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[ensemble-channel-bridge] mcp server up; ws=${WS_URL} session=${SESSION_ID} seat=${SEAT_ID}\n`,
  );
}

process.on("SIGTERM", () => {
  shuttingDown = true;
  ws?.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  shuttingDown = true;
  ws?.close();
  process.exit(0);
});

main().catch((err) => {
  process.stderr.write(`[ensemble-channel-bridge] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
