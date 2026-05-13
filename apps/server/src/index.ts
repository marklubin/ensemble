import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { sessions, setPersonaStore } from "./session/routes.ts";
import { createModeratorRoutes } from "./session/moderator-routes.ts";
import { defaultMcpServerHost } from "./mcp/index.ts";
import { createMemoryStore } from "./memory/index.ts";
import { createMemoryRoutes } from "./memory/routes.ts";
import { createPersonaStore } from "./personas/index.ts";
import { createPersonaRoutes } from "./personas/routes.ts";
import { createTemplateRoutes } from "./templates/routes.ts";
import { runtimes, uiBridge, channelCoordinator } from "./runtimes/index.ts";
import { createChannelsRoutes } from "./channels/ws-route.ts";
import { websocket } from "hono/bun";

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
app.route("/channels", createChannelsRoutes(channelCoordinator()));

// In production we serve the built React app from the same machine.
// Vite emits `apps/web/dist/`; the Dockerfile copies it into the runner
// image at the same path. Dev mode uses Vite on :5173 directly so this
// block is a no-op locally.
if (process.env.NODE_ENV === "production") {
  app.use(
    "/*",
    serveStatic({
      root: "./apps/web/dist",
      // SPA fallback: unknown paths fall through to index.html so React
      // Router handles routing client-side.
      rewriteRequestPath: (path) =>
        path.startsWith("/assets/") ? path : "/index.html",
    }),
  );
}

const port = Number(Bun.env.PORT ?? 4111);
console.log(
  `ensemble server :${port} (memory: ${memory.constructor.name}, personas: ${personas.count()})`,
);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
