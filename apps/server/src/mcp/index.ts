import { Hono } from "hono";
import { HOST_API_TOOLS, type HostApiToolName } from "@ensemble/shared";

/**
 * Host API MCP server. Skeleton — Decisions agent picks the actual MCP
 * library wiring (likely @modelcontextprotocol/sdk's HTTP transport).
 *
 * For v0 boot, this is a plain HTTP endpoint that lists tools and a
 * stub call endpoint that returns "not_implemented". Real MCP framing
 * comes from the SDK.
 */
export const mcpServer = new Hono();

mcpServer.get("/tools", (c) => {
  const tools = (Object.keys(HOST_API_TOOLS) as HostApiToolName[]).map(
    (name) => ({
      name,
      description: HOST_API_TOOLS[name].description,
      requires_claim:
        "requires_claim" in HOST_API_TOOLS[name]
          ? (HOST_API_TOOLS[name] as { requires_claim?: string }).requires_claim
          : null,
    }),
  );
  return c.json({ tools });
});

mcpServer.post("/call/:tool", async (c) => {
  // TODO(decisions): validate token, dispatch to tool handler
  return c.json(
    {
      error: "not_implemented",
      tool: c.req.param("tool"),
      todo: "Decisions agent wires real MCP transport + token validation",
    },
    501,
  );
});
