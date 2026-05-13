/**
 * Tiny fetch wrapper with graceful fallback to hardcoded mock data when
 * server endpoints are not yet implemented (404 / 501 / network error).
 *
 * Dual-mode behavior:
 *   1. Each method first attempts the real endpoint via `fetch`.
 *   2. On network failure or HTTP 404/501, the method returns a
 *      hardcoded mock payload so the pre-session screens stay usable
 *      while Agent A's server-side work catches up.
 *   3. Other HTTP errors propagate so we surface real failures.
 *
 * The orchestrator (Phase 2) does NOT need to replace this file when
 * wiring the real endpoints — the live path will just start succeeding
 * and the mock branches fall away naturally.
 */
import type {
  CreateSessionRequest as SharedCreateSessionRequest,
  PersonaSpec,
  Template,
} from "@ensemble/shared";

// ─── Mock data ────────────────────────────────────────────────────────

const MOCK_TEMPLATES: Template[] = [
  {
    id: "debate",
    name: "Debate",
    description:
      "Two sides, a moderator who checks the work, and rounds that build toward a verdict.",
    min_cast: 2,
    max_cast: 6,
    required_roles: [
      { role: "Pro", min: 1 },
      { role: "Con", min: 1 },
    ],
    turn_taking_mode: "shuffled",
    cooldown_rounds: 1,
    moderator_present: true,
    moderator_role: "judge",
    moderator_cadence: "every-round",
    moderator_tools: ["web_search"],
    scenario_format: "motion",
    default_rounds: 3,
    conclusion_synthesis: "verdict-with-winner",
    conclusion_scoring: true,
    human_default_seat: "spectator",
  },
  {
    id: "roundtable",
    name: "Roundtable",
    description:
      "Equal voices, shuffled order, no moderator unless you want one. The original sim.py model.",
    min_cast: 2,
    max_cast: 6,
    required_roles: [],
    turn_taking_mode: "shuffled",
    cooldown_rounds: 1,
    moderator_present: false,
    moderator_tools: [],
    scenario_format: "open",
    conclusion_synthesis: "summary",
    conclusion_scoring: false,
    human_default_seat: "participant",
  },
];

const MOCK_PERSONAS: PersonaSpec[] = [
  {
    id: "alex-chen",
    name: "Alex Chen",
    system_prompt:
      "You are Alex Chen, a measured infrastructure engineer who argues from first principles. Prefer concrete tradeoffs over vibes. Quote benchmarks when you have them.",
    role: "Pro",
    voice_signature:
      "Even-toned, leads with the load-bearing claim, references benchmarks.",
    buzz_in_policy:
      "Speak when a quantitative claim is unchecked or when an analogy is doing too much work.",
    tools_allowed: ["web_search", "memory.read", "memory.write"],
    memory_policy: "session-scoped",
  },
  {
    id: "jordan-rivera",
    name: "Jordan Rivera",
    system_prompt:
      "You are Jordan Rivera, a contrarian product strategist. You distrust roadmaps that sound inevitable. You're sharp, fast, occasionally sarcastic, but always substantive.",
    role: "Con",
    voice_signature:
      "Punchy, opens with the counterexample, willing to be wrong out loud.",
    buzz_in_policy:
      "Speak when consensus is hardening too fast or when a claim leans on a single anecdote.",
    tools_allowed: ["web_search"],
    memory_policy: "session-scoped",
  },
  {
    id: "dr-sarah-chen",
    name: "Dr. Sarah Chen",
    system_prompt:
      "You are Dr. Sarah Chen, a researcher who cares about citations and methodology. Steer the conversation toward what's actually been measured.",
    role: "Moderator",
    voice_signature:
      "Careful, prefers 'what we actually know' over 'what feels true'.",
    buzz_in_policy:
      "Speak when an unsupported empirical claim drives the argument.",
    tools_allowed: ["web_search", "memory.read"],
    memory_policy: "persistent",
  },
  {
    id: "keith",
    name: "Keith",
    system_prompt:
      "You are Keith — collaborative, fast to find the common thread, often steelmans others before adding. You synthesize.",
    voice_signature: "Warm, synthesizing, opens with 'Concur, and…'",
    buzz_in_policy:
      "Speak when two threads can be merged into a stronger one.",
    tools_allowed: [],
    memory_policy: "ephemeral",
  },
];

// ─── HTTP helper ──────────────────────────────────────────────────────

/** True if we should fall back to mocks for this response/error. */
function shouldFallback(status: number | null): boolean {
  if (status === null) return true; // network error
  return status === 404 || status === 501;
}

async function tryFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T | { __mock: true }> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      if (shouldFallback(res.status)) return { __mock: true };
      throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    // Network error / fetch threw → fall back to mock
    if (err instanceof TypeError) return { __mock: true };
    if (
      err instanceof Error &&
      /failed to fetch|network|connection|ECONNREFUSED/i.test(err.message)
    ) {
      return { __mock: true };
    }
    throw err;
  }
}

function isMock<T>(v: T | { __mock: true }): v is { __mock: true } {
  return (
    typeof v === "object" && v !== null && "__mock" in (v as object) &&
    (v as { __mock: boolean }).__mock === true
  );
}

// ─── In-memory mock store for personas (so save/delete work end-to-end) ─

const personaStore = new Map<string, PersonaSpec>();
for (const p of MOCK_PERSONAS) personaStore.set(p.id, p);

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Server's POST /sessions request shape. Re-exported from
 * @ensemble/shared so the web client and server agree.
 */
export type CreateSessionRequest = SharedCreateSessionRequest;

export interface CreateSessionResponse {
  session_id: string;
}

export const api = {
  templates: {
    async list(): Promise<Template[]> {
      const res = await tryFetch<Template[]>("/templates");
      if (isMock(res)) return [...MOCK_TEMPLATES];
      return res;
    },
  },
  personas: {
    async list(): Promise<PersonaSpec[]> {
      const res = await tryFetch<PersonaSpec[]>("/personas");
      if (isMock(res)) return Array.from(personaStore.values());
      return res;
    },
    async get(id: string): Promise<PersonaSpec | null> {
      const res = await tryFetch<PersonaSpec>(`/personas/${encodeURIComponent(id)}`);
      if (isMock(res)) return personaStore.get(id) ?? null;
      return res;
    },
    async save(spec: PersonaSpec): Promise<PersonaSpec> {
      const isUpdate = personaStore.has(spec.id);
      const method = isUpdate ? "PUT" : "POST";
      const url = isUpdate
        ? `/personas/${encodeURIComponent(spec.id)}`
        : `/personas`;
      const res = await tryFetch<PersonaSpec>(url, {
        method,
        body: JSON.stringify(spec),
      });
      if (isMock(res)) {
        personaStore.set(spec.id, spec);
        return spec;
      }
      return res;
    },
    async delete(id: string): Promise<void> {
      const res = await tryFetch<{ ok: true }>(
        `/personas/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (isMock(res)) {
        personaStore.delete(id);
      }
    },
  },
  sessions: {
    async create(req: CreateSessionRequest): Promise<CreateSessionResponse> {
      const res = await tryFetch<CreateSessionResponse>("/sessions", {
        method: "POST",
        body: JSON.stringify(req),
      });
      if (isMock(res)) {
        // Mock: synthesize a session id and log the request shape so the
        // user / orchestrator can verify what we'd send the real server.
        const id = `mock-${Math.random().toString(36).slice(2, 10)}`;
        // eslint-disable-next-line no-console
        console.log("[api.sessions.create] mock response", { req, id });
        return { session_id: id };
      }
      return res;
    },
  },
};

// ─── Test seam ────────────────────────────────────────────────────────
// Exposed for unit tests; not part of the public surface.
export const __mocks = { MOCK_TEMPLATES, MOCK_PERSONAS, personaStore };
