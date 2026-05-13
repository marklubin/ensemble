import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { HOST_API_TOOLS, type HostApiToolName } from "@ensemble/shared";
import { config } from "../config/index.ts";
import { issue, verify, InvalidTokenError } from "../auth/jwt.ts";
import type { TokenPayload } from "../auth/jwt.ts";
import { BuzzCoordinator } from "./buzz-coordinator.ts";
import { SessionRegistry } from "./session-registry.ts";
import type { ISessionRegistry } from "./session-registry.ts";
import { InProcessEventBus } from "./event-bus.ts";
import type { IEventBus } from "./event-bus.ts";
import { buildMcpServerForAuth } from "./server.ts";
import type { IMemoryStore } from "../memory/store.ts";
import { MemoryStore } from "../memory/store.ts";

export { BuzzCoordinator } from "./buzz-coordinator.ts";
export { SessionRegistry } from "./session-registry.ts";
export type { SessionView, ISessionRegistry } from "./session-registry.ts";
export { InProcessEventBus } from "./event-bus.ts";
export type { IEventBus, BusEvent, ModeratorBusEvent } from "./event-bus.ts";
export { buildMcpServerForAuth } from "./server.ts";

/**
 * Top-level MCP HTTP surface for Ensemble. Exposes:
 *
 *   GET  /mcp/tools                 — static catalogue (auth-free; helps debugging)
 *   POST /mcp/rpc                   — JSON-RPC over Streamable HTTP, JWT-gated
 *   GET  /mcp/rpc                   — SSE GET for server-initiated messages
 *   DELETE /mcp/rpc                 — terminate session
 *
 * Per-session URLs are constructed by `getSessionMcpUrl(sessionId)`;
 * a runtime hands the URL + a scoped token to its persona. The
 * session_id encoded in the JWT scopes every call — there's no
 * path-based session id, by design (a token alone is sufficient).
 */

export interface McpServerHostDeps {
  memory: IMemoryStore;
  sessions: ISessionRegistry;
  bus: IEventBus;
  buzz: BuzzCoordinator;
}

export interface McpServerHost {
  app: Hono;
  deps: McpServerHostDeps;
  mintSessionToken(input: MintInput): string;
  getSessionMcpUrl(sessionId: string): string;
}

export interface MintInput {
  session_id: string;
  seat_id: string;
  claims: string[];
  ttlSeconds?: number;
}

/**
 * Construct the full MCP HTTP surface plus token minting helpers.
 * Pass overrides for tests; production wires the singletons.
 */
export function createMcpServerHost(
  overrides: Partial<McpServerHostDeps> = {},
): McpServerHost {
  const deps: McpServerHostDeps = {
    memory: overrides.memory ?? new MemoryStore(),
    sessions: overrides.sessions ?? new SessionRegistry(),
    bus: overrides.bus ?? new InProcessEventBus(),
    buzz: overrides.buzz ?? new BuzzCoordinator(),
  };

  const app = new Hono();

  // Public catalogue endpoint — useful for clients sniffing capabilities
  // before they have a token. No state leaked here.
  app.get("/tools", (c) => {
    const tools = (Object.keys(HOST_API_TOOLS) as HostApiToolName[]).map(
      (name) => ({
        name,
        description: HOST_API_TOOLS[name].description,
        requires_claim:
          "requires_claim" in HOST_API_TOOLS[name]
            ? (HOST_API_TOOLS[name] as { requires_claim?: string })
                .requires_claim
            : null,
      }),
    );
    return c.json({ tools });
  });

  // The MCP JSON-RPC endpoint. We verify the JWT here (before handing
  // off to the SDK transport) so the auth context is in scope when we
  // build the per-request McpServer instance.
  app.all("/rpc", async (c) => {
    const authHeader =
      c.req.header("authorization") ?? c.req.header("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return c.json(
        { error: "INVALID_TOKEN", message: "missing bearer token" },
        401,
      );
    }
    let payload: TokenPayload;
    try {
      payload = verify(
        authHeader.slice("bearer ".length).trim(),
        config().jwtSecret,
      );
    } catch (e) {
      const msg = e instanceof InvalidTokenError ? e.message : "invalid";
      return c.json({ error: "INVALID_TOKEN", message: msg }, 401);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: every request is independent. JWT carries identity.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = buildMcpServerForAuth(payload, deps);

    // Make sure we tear down when the request closes.
    transport.onclose = () => {
      void server.close();
    };

    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return {
    app,
    deps,
    mintSessionToken: (input) =>
      issue(
        {
          session_id: input.session_id,
          seat_id: input.seat_id,
          claims: input.claims,
          ttlSeconds: input.ttlSeconds,
        },
        config().jwtSecret,
      ),
    getSessionMcpUrl: (_sessionId: string) =>
      // session_id is encoded in the token, not the path. Returning a
      // single endpoint keeps the surface tidy.
      `${config().mcpPublicUrl.replace(/\/$/, "")}/mcp/rpc`,
  };
}

// ─── Default singleton wiring for `apps/server/src/index.ts` ─────────

let _host: McpServerHost | null = null;
export function defaultMcpServerHost(
  overrides: Partial<McpServerHostDeps> = {},
): McpServerHost {
  if (!_host) _host = createMcpServerHost(overrides);
  return _host;
}

/**
 * Hono router exposed at `/mcp` from the root app. Wraps the default
 * singleton host. Tests don't need this — they use `createMcpServerHost`
 * directly.
 */
export const mcpServer = (() => {
  const host = defaultMcpServerHost();
  return host.app;
})();

export function mintSessionToken(input: MintInput): string {
  return defaultMcpServerHost().mintSessionToken(input);
}

export function getSessionMcpUrl(sessionId: string): string {
  return defaultMcpServerHost().getSessionMcpUrl(sessionId);
}
