import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessions } from "./session/routes.ts";
import { mcpServer } from "./mcp/index.ts";
import { runtimes, uiBridge } from "./runtimes/index.ts";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    runtimes: Object.keys(runtimes),
    ts: new Date().toISOString(),
  }),
);

app.route("/sessions", sessions);
app.route("/mcp", mcpServer);
app.route("/ui-bridge", uiBridge.routes);

const port = Number(Bun.env.PORT ?? 4111);
console.log(`ensemble server :${port}`);

export default {
  port,
  fetch: app.fetch,
};
