import type { MiddlewareHandler } from "hono";
import { verify, InvalidTokenError, hasClaim } from "./jwt.ts";
import type { TokenPayload } from "./jwt.ts";

/**
 * Hono middlewares for the Ensemble Host API.
 *
 * - `authMiddleware(secret)` extracts `Authorization: Bearer <jwt>`,
 *   verifies it with the shared secret, and attaches the parsed
 *   payload to `c.var.auth`. Rejects with 401 INVALID_TOKEN on failure.
 * - `requireClaim(claim)` 403s if the verified payload lacks the claim.
 * - `requireSeatMatch(param)` 403s if `c.req.param(param)` doesn't
 *   equal the token's `seat_id`. Used for memory namespacing on
 *   path-scoped endpoints (the MCP transport itself does this via
 *   `c.var.auth` directly).
 */

export type AuthVars = { auth: TokenPayload };

export interface ErrorEnvelope {
  error: "FORBIDDEN" | "INVALID_TOKEN";
  message: string;
}

export const authMiddleware =
  (secret: string): MiddlewareHandler<{ Variables: AuthVars }> =>
  async (c, next) => {
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      return c.json<ErrorEnvelope>(
        { error: "INVALID_TOKEN", message: "missing bearer token" },
        401,
      );
    }
    const token = header.slice("bearer ".length).trim();
    try {
      const payload = verify(token, secret);
      c.set("auth", payload);
    } catch (e) {
      const msg = e instanceof InvalidTokenError ? e.message : "invalid";
      return c.json<ErrorEnvelope>({ error: "INVALID_TOKEN", message: msg }, 401);
    }
    return next();
  };

export const requireClaim =
  (claim: string): MiddlewareHandler<{ Variables: AuthVars }> =>
  async (c, next) => {
    const auth = c.var.auth;
    if (!auth || !hasClaim(auth, claim)) {
      return c.json<ErrorEnvelope>(
        { error: "FORBIDDEN", message: `requires '${claim}' claim` },
        403,
      );
    }
    return next();
  };

export const requireSeatMatch =
  (paramName: string): MiddlewareHandler<{ Variables: AuthVars }> =>
  async (c, next) => {
    const auth = c.var.auth;
    const seat = c.req.param(paramName);
    if (!auth || !seat || auth.seat_id !== seat) {
      return c.json<ErrorEnvelope>(
        { error: "FORBIDDEN", message: "seat mismatch" },
        403,
      );
    }
    return next();
  };
