/**
 * WebSocket upgrade route for the channel bridge.
 *
 * Mounted at `/channels/ws` on the main Hono server. The brief
 * specified `ws` (the npm package) for upgrade handling; in practice
 * Hono's `bun` adapter wraps Bun's native ServerWebSocket and gives us
 * the same surface (open / message / close), so we use that for the
 * server side. The channel-bridge on the client side still dials with
 * the `ws` package. This is documented in HANDOFF.md.
 *
 * The route accepts the connection unconditionally; auth is done by
 * `ChannelCoordinator.acceptConnection` once we have the first
 * `register` frame. Token can come from either:
 *   - `Authorization: Bearer <t>` header, or
 *   - `?token=<t>` query string.
 *
 * Why both: development MCP launchers like Claude Code can pass an
 * `Authorization` header via their config; bunx-launched bridges may
 * find query-string auth more portable.
 */

import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";

import type {
  ChannelConnection,
  ChannelCoordinator,
} from "./coordinator.ts";

export function createChannelsRoutes(coordinator: ChannelCoordinator): Hono {
  const app = new Hono();

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      // Extract presented token at upgrade time.
      const url = new URL(c.req.url);
      const qsToken = url.searchParams.get("token") ?? undefined;
      const auth = c.req.header("authorization");
      const headerToken = auth?.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : undefined;
      const token = headerToken ?? qsToken;

      // Buffer to capture handlers from `acceptConnection` so we can
      // route events from Hono's WSContext into them.
      let msgHandler: ((p: string) => void) | null = null;
      let closeHandler:
        | ((info: { code?: number; reason?: string }) => void)
        | null = null;

      // We need a reference to the WSContext to send/close from
      // `ChannelConnection`. Captured in `onOpen`.
      let wsCtx: WSContext<unknown> | null = null;

      const conn: ChannelConnection = {
        send(payload: string) {
          if (!wsCtx) throw new Error("channel ws not yet open");
          wsCtx.send(payload);
        },
        close(code?: number, reason?: string) {
          wsCtx?.close(code, reason);
        },
        onMessage(h: (p: string) => void) {
          msgHandler = h;
        },
        onClose(h: (info: { code?: number; reason?: string }) => void) {
          closeHandler = h;
        },
      };

      // Adopt the connection now (before `onOpen`) so that handlers
      // are registered before the first frame can arrive.
      coordinator.acceptConnection(conn, token);

      return {
        onOpen(_evt, ws) {
          wsCtx = ws;
        },
        onMessage(evt, _ws) {
          const data = evt.data;
          const payload =
            typeof data === "string"
              ? data
              : data instanceof ArrayBuffer
                ? new TextDecoder().decode(data)
                : String(data);
          msgHandler?.(payload);
        },
        onClose(evt) {
          closeHandler?.({ code: evt.code, reason: evt.reason });
        },
        onError(_evt) {
          // Close handler will fire too; nothing extra to do.
        },
      };
    }),
  );

  return app;
}
