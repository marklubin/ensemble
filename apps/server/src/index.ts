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
import { logger, shortId } from "./logging/index.ts";

// Process-level error trap: log before Bun tears the process down.
// Surfaces stack traces that would otherwise vanish into Fly's
// "connection closed before message completed" proxy errors.
process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", {
    error: err.message,
    stack: err.stack,
  });
});
process.on("unhandledRejection", (reason) => {
  const err =
    reason instanceof Error ? reason : new Error(String(reason));
  logger.error("unhandled_rejection", {
    error: err.message,
    stack: err.stack,
  });
});

// Resolve the memory + persona stores per config (default: sqlite).
const memory = await createMemoryStore();
const personas = await createPersonaStore();
setPersonaStore(personas);

const mcpHost = defaultMcpServerHost({ memory });

const app = new Hono<{ Variables: { request_id: string } }>();

// Per-request structured logging: a fresh request_id per inbound HTTP
// request, attached to `c.var.request_id` so downstream handlers can
// include it in their own logs. We intentionally log AFTER the handler
// runs so we have status + duration in one line.
app.use("*", async (c, next) => {
  const requestId = shortId();
  c.set("request_id", requestId);
  const started = Date.now();
  const flyIp = c.req.header("fly-client-ip");
  logger.info("http.request", {
    request_id: requestId,
    method: c.req.method,
    path: c.req.path,
    fly_client_ip: flyIp,
  });
  try {
    await next();
  } finally {
    const durationMs = Date.now() - started;
    const status = c.res.status;
    const contentLength = c.res.headers.get("content-length");
    logger.info("http.response", {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      duration_ms: durationMs,
      content_length: contentLength ? Number(contentLength) : null,
    });
  }
});

// Hono-level error handler. Anything that bubbles up here would
// otherwise be silently 500'd; we want the stack + request_id.
app.onError((err, c) => {
  const requestId = c.get("request_id");
  logger.error("unhandled_error", {
    path: c.req.path,
    method: c.req.method,
    request_id: requestId,
    error: err.message,
    stack: err.stack,
  });
  return c.json(
    { error: "internal_error", request_id: requestId ?? null },
    500,
  );
});

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

// Single canonical boot line. Useful for grepping `fly logs` to
// confirm a fresh deploy is up + which runtimes registered.
logger.info("boot", {
  version: "0.0.1",
  node_env: process.env.NODE_ENV ?? "development",
  port,
  registered_runtimes: Object.keys(runtimes),
  memory_backend: memory.constructor.name,
  persona_count: personas.count(),
  has_anthropic_api_key: Boolean(process.env.ANTHROPIC_API_KEY),
  has_jwt_secret: Boolean(process.env.JWT_SECRET),
  channel_ws_mounted: true,
});

// Legacy log line preserved so existing operator muscle-memory still
// surfaces something on `fly logs`.
// eslint-disable-next-line no-console
console.log(
  `ensemble server :${port} (memory: ${memory.constructor.name}, personas: ${personas.count()})`,
);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
