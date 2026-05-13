import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  HOST_API_TOOLS,
  type HostApiToolName,
} from "@ensemble/shared";
import {
  buildHandlers,
  type Handler,
  type HandlerDeps,
} from "./handlers.ts";
import type { TokenPayload } from "../auth/jwt.ts";

/**
 * Build a fully-wired `McpServer` for a single authenticated caller.
 *
 * Why per-call construction:
 *   Each McpServer caches tool metadata against a connection. The
 *   auth context (session_id, seat_id, claims) is naturally a
 *   per-connection thing, so we build a fresh server per accepted
 *   request/transport and close it when the request ends. Allocation
 *   cost is negligible compared to the model call that prompted the
 *   tool call.
 *
 * Why we don't gate moderator tools by hiding them from the tool list:
 *   The spec requires *server-side* rejection so that a leaked
 *   moderator-shaped prompt template can't escalate. Handlers do the
 *   claim check. We DO still surface them — agents see them in the
 *   tool list and the handler returns a structured FORBIDDEN if
 *   misused. This matches the architecture.md guidance:
 *   "Server-side validation rejects misuse cleanly."
 */
export function buildMcpServerForAuth(
  auth: TokenPayload,
  deps: HandlerDeps,
): McpServer {
  const server = new McpServer(
    { name: "ensemble-host-api", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Ensemble Host API. Tools are session-scoped to your seat.",
    },
  );

  const handlers = buildHandlers(deps);

  for (const toolName of Object.keys(HOST_API_TOOLS) as HostApiToolName[]) {
    const spec = HOST_API_TOOLS[toolName];
    const handler = handlers[toolName] as Handler;
    const inputShape = (spec.input as z.ZodObject<z.ZodRawShape>).shape;
    server.registerTool(
      toolName,
      {
        description: spec.description,
        // McpServer expects a raw shape (Record<string, ZodTypeAny>);
        // pass the underlying object's `.shape` for each tool.
        inputSchema: inputShape,
      },
      async (args: unknown) => {
        return handler(auth, args);
      },
    );
  }

  return server;
}
