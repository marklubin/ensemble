import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessions, setPersonaStore } from "./session/routes.ts";
import { createModeratorRoutes } from "./session/moderator-routes.ts";
import { defaultMcpServerHost } from "./mcp/index.ts";
import { createMemoryStore } from "./memory/index.ts";
import { createMemoryRoutes } from "./memory/routes.ts";
import { createPersonaStore } from "./personas/index.ts";
import { createPersonaRoutes } from "./personas/routes.ts";
import { createTemplateRoutes } from "./templates/routes.ts";
import { runtimes, uiBridge } from "./runtimes/index.ts";

// Resolve the memory + persona stores per config (default: sqlite).
const memory = await createMemoryStore();
const personas = await createPersonaStore();
setPersonaStore(personas);

const mcpHost = defaultMcpServerHost({ memory });

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    runtimes: Object.keys(runtimes),
    memory_backend: memory.constructor.name,
    persona_count: personas.count(),
    ts: new Date().toISOString(),
  }),
);

app.route("/sessions", sessions);
app.route("/sessions", createMemoryRoutes(memory));
app.route("/sessions", createModeratorRoutes());
app.route("/personas", createPersonaRoutes(personas));
app.route("/templates", createTemplateRoutes());
app.route("/mcp", mcpHost.app);
app.route("/ui-bridge", uiBridge.routes);

const port = Number(Bun.env.PORT ?? 4111);
console.log(
  `ensemble server :${port} (memory: ${memory.constructor.name}, personas: ${personas.count()})`,
);

export default {
  port,
  fetch: app.fetch,
};
