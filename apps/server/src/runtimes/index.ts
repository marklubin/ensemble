import type { PersonaRuntime } from "@ensemble/shared";

/**
 * Runtime registry. Each integrator agent adds its runtime here.
 *
 *   import { ManagedAgentsRuntime } from "./managed-agents/index.ts";
 *   runtimes["managed-agents"] = new ManagedAgentsRuntime(...);
 *
 * Scheduler looks up by seat.runtime_type.
 */
export const runtimes: Record<string, PersonaRuntime> = {};
