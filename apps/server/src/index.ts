import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessions } from "./session/routes.ts";
import { defaultMcpServerHost } from "./mcp/index.ts";
import { createMemoryStore } from "./memory/index.ts";
import { runtimes, uiBridge } from "./runtimes/index.ts";

// Resolve the memory store per config (default: sqlite). Done up-front
// so the MCP server is constructed with the right backend.
const memory = await createMemoryStore();
const mcpHost = defaultMcpServerHost({ memory });

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    runtimes: Object.keys(runtimes),
    memory_backend: memory.constructor.name,
    ts: new Date().toISOString(),
  }),
);

app.route("/sessions", sessions);
app.route("/mcp", mcpHost.app);
app.route("/ui-bridge", uiBridge.routes);

const port = Number(Bun.env.PORT ?? 4111);
console.log(`ensemble server :${port} (memory: ${memory.constructor.name})`);

export default {
  port,
  fetch: app.fetch,
};
