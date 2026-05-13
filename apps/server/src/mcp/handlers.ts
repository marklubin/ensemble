import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  BuzzerPressInput,
  BuzzerPassInput,
  MemoryReadInput,
  MemoryWriteInput,
  MemoryListInput,
  CastListInput,
  RoundInfoInput,
  ModForceSpeakerInput,
  ModCooldownInput,
  ModBypassInput,
  ModInjectInput,
} from "@ensemble/shared";
import type { TokenPayload } from "../auth/jwt.ts";
import { hasClaim } from "../auth/jwt.ts";
import type { IMemoryStore } from "../memory/store.ts";
import type { BuzzCoordinator } from "./buzz-coordinator.ts";
import type { ISessionRegistry } from "./session-registry.ts";
import type { IEventBus } from "./event-bus.ts";

/**
 * MCP tool handlers (the Host API).
 *
 * Each handler:
 *   1. Validates `args` against the input Zod schema from @ensemble/shared.
 *   2. Checks claims if the tool is privileged.
 *   3. Performs the side-effect (memory, buzz resolution, event bus).
 *   4. Returns a `CallToolResult` shaped per MCP — content + structuredContent.
 *
 * Responses are Zod-validated where there's a meaningful shape; for
 * pure-effect handlers we return `{ok:true}`.
 */

// ─── Response schemas (local — see ADR for why these aren't shared) ─

export const OkResponse = z.object({ ok: z.literal(true) });
export const BuzzAckResponse = z.object({
  ok: z.boolean(),
  resolved: z.boolean(),
});
export const MemoryReadResponse = z.object({
  key: z.string(),
  value: z.unknown(),
  exists: z.boolean(),
});
export const MemoryWriteResponse = z.object({
  ok: z.literal(true),
  key: z.string(),
});
export const MemoryListResponse = z.object({ keys: z.array(z.string()) });
export const CastListResponse = z.object({
  cast: z.array(
    z.object({
      seat_id: z.string(),
      persona_id: z.string(),
      persona_name: z.string(),
      role: z.string().optional(),
      runtime_type: z.string(),
    }),
  ),
});
export const RoundInfoResponse = z.object({
  round: z.number().int(),
  mode: z.string(),
  cooldown_remaining: z.number().int(),
});

// ─── Wiring deps the handlers close over ─────────────────────────────

export interface HandlerDeps {
  memory: IMemoryStore;
  buzz: BuzzCoordinator;
  sessions: ISessionRegistry;
  bus: IEventBus;
}

// ─── Error envelope used inside the MCP "isError" channel ────────────

export class ToolError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

function ok(structured: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured as Record<string, unknown>,
  };
}

function err(code: ToolError["code"], message: string): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error: code, message }) },
    ],
    structuredContent: { error: code, message },
  };
}

function parseOr<T>(
  schema: z.ZodType<T>,
  args: unknown,
): { ok: true; data: T } | { ok: false; result: CallToolResult } {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      result: err("INVALID_INPUT", parsed.error.message),
    };
  }
  return { ok: true, data: parsed.data };
}

function requireClaim(
  auth: TokenPayload,
  claim: string,
): CallToolResult | null {
  if (!hasClaim(auth, claim)) {
    return err("FORBIDDEN", `requires '${claim}' claim`);
  }
  return null;
}

// ─── Nonce extraction for buzzer.* ───────────────────────────────────

/**
 * The runtime injects a nonce into the buzz-check prompt and asks the
 * persona to echo it back via the `nonce` arg. To keep the published
 * Host API schemas in @ensemble/shared (frozen) untouched, we accept
 * the nonce *either* as a top-level extension field on the args object
 * *or* embedded as the suffix `#nonce:<value>` of the `intent` /
 * `reason` string. Either path works; runtimes pick what's cleaner.
 *
 * If no nonce is provided we still accept the tool call (it just
 * doesn't resolve a waiter) — important for runtimes that don't
 * implement buzz-check.
 */
const NONCE_FIELD = "nonce";
const NONCE_TAG_RE = /\s*#nonce:([A-Za-z0-9_-]{8,})\s*$/;

function extractNonce(rawArgs: unknown, str?: string): string | null {
  if (rawArgs && typeof rawArgs === "object" && NONCE_FIELD in rawArgs) {
    const v = (rawArgs as Record<string, unknown>)[NONCE_FIELD];
    if (typeof v === "string" && v.length >= 8) return v;
  }
  if (str) {
    const m = str.match(NONCE_TAG_RE);
    if (m && m[1]) return m[1];
  }
  return null;
}

// ─── Handler factory ─────────────────────────────────────────────────

export type Handler = (
  auth: TokenPayload,
  args: unknown,
) => Promise<CallToolResult>;

export function buildHandlers(deps: HandlerDeps): Record<string, Handler> {
  return {
    "buzzer.press": async (auth, args) => {
      const p = parseOr(BuzzerPressInput, args);
      if (!p.ok) return p.result;
      const nonce = extractNonce(args, p.data.intent);
      let resolved = false;
      if (nonce) {
        resolved = deps.buzz.resolvePress(
          {
            session_id: auth.session_id,
            seat_id: auth.seat_id,
            nonce,
          },
          p.data.intensity,
          p.data.intent,
        );
      }
      return ok({ ok: true, resolved });
    },

    "buzzer.pass": async (auth, args) => {
      const p = parseOr(BuzzerPassInput, args);
      if (!p.ok) return p.result;
      const nonce = extractNonce(args, p.data.reason);
      let resolved = false;
      if (nonce) {
        resolved = deps.buzz.resolvePass(
          {
            session_id: auth.session_id,
            seat_id: auth.seat_id,
            nonce,
          },
          p.data.reason,
        );
      }
      return ok({ ok: true, resolved });
    },

    "memory.read": async (auth, args) => {
      const p = parseOr(MemoryReadInput, args);
      if (!p.ok) return p.result;
      const value = deps.memory.read(
        auth.session_id,
        auth.seat_id,
        p.data.key,
      );
      return ok({
        key: p.data.key,
        value: value ?? null,
        exists: value !== undefined,
      });
    },

    "memory.write": async (auth, args) => {
      const p = parseOr(MemoryWriteInput, args);
      if (!p.ok) return p.result;
      deps.memory.write(
        auth.session_id,
        auth.seat_id,
        p.data.key,
        p.data.value,
      );
      return ok({ ok: true, key: p.data.key });
    },

    "memory.list": async (auth, args) => {
      const p = parseOr(MemoryListInput, args);
      if (!p.ok) return p.result;
      return ok({ keys: deps.memory.list(auth.session_id, auth.seat_id) });
    },

    "cast.list": async (auth, args) => {
      const p = parseOr(CastListInput, args);
      if (!p.ok) return p.result;
      const view = deps.sessions.get(auth.session_id);
      if (!view) return err("NOT_FOUND", "session not registered");
      return ok({ cast: view.cast });
    },

    "round.info": async (auth, args) => {
      const p = parseOr(RoundInfoInput, args);
      if (!p.ok) return p.result;
      const view = deps.sessions.get(auth.session_id);
      if (!view) return err("NOT_FOUND", "session not registered");
      return ok({
        round: view.round,
        mode: view.mode,
        cooldown_remaining: view.cooldownFor(auth.seat_id),
      });
    },

    "moderator.force_speaker": async (auth, args) => {
      const claim = requireClaim(auth, "moderator");
      if (claim) return claim;
      const p = parseOr(ModForceSpeakerInput, args);
      if (!p.ok) return p.result;
      deps.bus.publish({
        type: "moderator",
        payload: {
          kind: "force_speaker",
          session_id: auth.session_id,
          issuer_seat_id: auth.seat_id,
          target_seat_id: p.data.seat_id,
          timestamp: new Date().toISOString(),
        },
      });
      return ok({ ok: true });
    },

    "moderator.cooldown": async (auth, args) => {
      const claim = requireClaim(auth, "moderator");
      if (claim) return claim;
      const p = parseOr(ModCooldownInput, args);
      if (!p.ok) return p.result;
      deps.bus.publish({
        type: "moderator",
        payload: {
          kind: "cooldown",
          session_id: auth.session_id,
          issuer_seat_id: auth.seat_id,
          target_seat_id: p.data.seat_id,
          rounds: p.data.rounds,
          reason: p.data.reason,
          timestamp: new Date().toISOString(),
        },
      });
      return ok({ ok: true });
    },

    "moderator.bypass": async (auth, args) => {
      const claim = requireClaim(auth, "moderator");
      if (claim) return claim;
      const p = parseOr(ModBypassInput, args);
      if (!p.ok) return p.result;
      deps.bus.publish({
        type: "moderator",
        payload: {
          kind: "bypass",
          session_id: auth.session_id,
          issuer_seat_id: auth.seat_id,
          target_seat_id: p.data.seat_id,
          reason: p.data.reason,
          timestamp: new Date().toISOString(),
        },
      });
      return ok({ ok: true });
    },

    "moderator.inject": async (auth, args) => {
      const claim = requireClaim(auth, "moderator");
      if (claim) return claim;
      const p = parseOr(ModInjectInput, args);
      if (!p.ok) return p.result;
      deps.bus.publish({
        type: "moderator",
        payload: {
          kind: "inject",
          session_id: auth.session_id,
          issuer_seat_id: auth.seat_id,
          timestamp: new Date().toISOString(),
        },
      });
      return ok({ ok: true });
    },
  };
}
