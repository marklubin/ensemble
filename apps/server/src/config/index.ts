import { z } from "zod";

/**
 * Typed config singleton. Loaded once from process env and validated.
 *
 * Env vars consumed:
 *   PORT                  — HTTP port (default 4111)
 *   ANTHROPIC_API_KEY     — Anthropic API key (optional in fixture/test mode)
 *   MCP_PUBLIC_URL        — Base URL runtimes use to reach the MCP server
 *   JWT_SECRET            — HS256 signing secret for MCP scoped tokens
 *   MEMORY_BACKEND        — "in-memory" | "sqlite"     (default sqlite)
 *   MEMORY_SQLITE_PATH    — sqlite file path           (default ./ensemble.sqlite)
 *   ENSEMBLE_TEST_MODE    — "fixture" | "live"         (default fixture)
 */
const ConfigSchema = z.object({
  port: z.number().int().positive(),
  anthropicApiKey: z.string().optional(),
  mcpPublicUrl: z.string().url(),
  jwtSecret: z.string().min(16),
  memoryBackend: z.enum(["in-memory", "sqlite"]),
  memorySqlitePath: z.string().min(1),
  testMode: z.enum(["fixture", "live"]),
});

export type Config = z.infer<typeof ConfigSchema>;

function readEnv(name: string): string | undefined {
  // Bun.env is preferred at runtime; process.env is the test fallback
  // and matches what Node-style code expects.
  const fromBun =
    typeof Bun !== "undefined" && Bun.env ? Bun.env[name] : undefined;
  return fromBun ?? process.env[name];
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const raw = {
    port: Number(readEnv("PORT") ?? 4111),
    anthropicApiKey: readEnv("ANTHROPIC_API_KEY"),
    mcpPublicUrl:
      readEnv("MCP_PUBLIC_URL") ?? `http://127.0.0.1:${readEnv("PORT") ?? 4111}`,
    jwtSecret:
      readEnv("JWT_SECRET") ?? "dev-only-secret-change-me-32-bytes-min",
    memoryBackend: (readEnv("MEMORY_BACKEND") ?? "sqlite") as
      | "in-memory"
      | "sqlite",
    memorySqlitePath: readEnv("MEMORY_SQLITE_PATH") ?? "./ensemble.sqlite",
    testMode: (readEnv("ENSEMBLE_TEST_MODE") ?? "fixture") as
      | "fixture"
      | "live",
  };
  return ConfigSchema.parse({ ...raw, ...overrides });
}

let _config: Config | null = null;

/** Lazily-loaded process-wide config. Tests can call `resetConfig()`. */
export function config(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}

export function resetConfig(overrides: Partial<Config> = {}): Config {
  _config = loadConfig(overrides);
  return _config;
}
