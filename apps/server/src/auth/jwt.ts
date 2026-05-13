import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Minimal HS256 JWT implementation. No external deps so we don't need
 * to add a new dep against Phase-0 pins.
 *
 * Claims encoded in the payload identify a (session_id, seat_id) pair
 * and an arbitrary string-claims array. The `moderator` claim, when
 * present, unlocks the moderator.* MCP tools.
 */

const HEADER = { alg: "HS256", typ: "JWT" } as const;

export const TokenPayload = z.object({
  session_id: z.string().min(1),
  seat_id: z.string().min(1),
  claims: z.array(z.string()),
  /** issued-at, seconds */
  iat: z.number().int().nonnegative(),
  /** expires-at, seconds (optional → never expires) */
  exp: z.number().int().positive().optional(),
});
export type TokenPayload = z.infer<typeof TokenPayload>;

export interface IssueInput {
  session_id: string;
  seat_id: string;
  claims: string[];
  /** Optional TTL in seconds. If omitted, token does not expire. */
  ttlSeconds?: number;
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const std = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(std, "base64");
}

function sign(message: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(message).digest();
  return b64urlEncode(sig);
}

export function issue(input: IssueInput, secret: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    session_id: input.session_id,
    seat_id: input.seat_id,
    claims: input.claims,
    iat,
    ...(input.ttlSeconds ? { exp: iat + input.ttlSeconds } : {}),
  };
  const header = b64urlEncode(JSON.stringify(HEADER));
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export function verify(token: string, secret: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new InvalidTokenError("malformed token");
  }
  const [header, body, sig] = parts as [string, string, string];

  // Signature check first.
  const expected = sign(`${header}.${body}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidTokenError("bad signature");
  }

  let headerJson: unknown;
  let payloadJson: unknown;
  try {
    headerJson = JSON.parse(b64urlDecode(header).toString("utf8"));
    payloadJson = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    throw new InvalidTokenError("malformed json");
  }

  const headerParsed = z
    .object({ alg: z.literal("HS256"), typ: z.literal("JWT") })
    .safeParse(headerJson);
  if (!headerParsed.success) {
    throw new InvalidTokenError("unsupported header");
  }

  const payloadParsed = TokenPayload.safeParse(payloadJson);
  if (!payloadParsed.success) {
    throw new InvalidTokenError("malformed payload");
  }
  const payload = payloadParsed.data;

  if (payload.exp !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) {
      throw new InvalidTokenError("expired");
    }
  }

  return payload;
}

/** Convenience: does this payload carry a given claim? */
export function hasClaim(payload: TokenPayload, claim: string): boolean {
  return payload.claims.includes(claim);
}
