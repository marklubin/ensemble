import type Anthropic from "@anthropic-ai/sdk";
import type { BuzzCoordinator, PersonaRuntime } from "@ensemble/shared";
import {
  ManagedAgentsRuntime,
  type ManagedAgentsClient,
} from "./managed-agents-runtime.ts";
import { DirectSdkRuntime } from "./direct-sdk-runtime.ts";

export { ManagedAgentsRuntime } from "./managed-agents-runtime.ts";
export { DirectSdkRuntime } from "./direct-sdk-runtime.ts";
export {
  formatEventsAsTurnPrompt,
  formatBuzzCheckPrompt,
} from "./prompts.ts";
export {
  AgentDefinitionCache,
  hashAgentDefinition,
  buildSystemPrompt,
  type AgentDefinition,
  type AgentDefinitionInput,
} from "./agent-definition.ts";

export type ManagedAgentsMode = "auto" | "managed" | "direct";

export interface CreateManagedAgentsRuntimeOpts {
  client: Anthropic;
  modelId: string;
  buzzCoordinator?: BuzzCoordinator;
  /** Override via env: MANAGED_AGENTS_MODE. Default "auto". */
  mode?: ManagedAgentsMode;
  /** Buzz-check timeout in ms (passed through to the runtime). */
  buzzTimeoutMs?: number;
}

/**
 * Auto-detect factory. Registry one-liner uses this:
 *
 *   runtimes['managed-agents'] = createManagedAgentsRuntime({
 *     client, modelId, buzzCoordinator,
 *   });
 *
 * Behavior:
 *   - mode="managed" → always ManagedAgentsRuntime (throws if beta absent at attach time).
 *   - mode="direct"  → always DirectSdkRuntime.
 *   - mode="auto"    → ManagedAgentsRuntime if `client.beta.managedAgents` exists, else DirectSdkRuntime.
 */
export function createManagedAgentsRuntime(
  opts: CreateManagedAgentsRuntimeOpts,
): PersonaRuntime {
  const mode: ManagedAgentsMode =
    opts.mode ??
    (process.env.MANAGED_AGENTS_MODE as ManagedAgentsMode | undefined) ??
    "auto";

  if (mode === "direct") {
    return new DirectSdkRuntime(
      opts.client,
      opts.modelId,
      opts.buzzCoordinator,
      { buzzTimeoutMs: opts.buzzTimeoutMs },
    );
  }

  if (mode === "managed") {
    if (!ManagedAgentsRuntime.isAvailable(opts.client)) {
      throw new Error(
        "MANAGED_AGENTS_MODE=managed but @anthropic-ai/sdk does not expose beta.managedAgents. " +
          "Upgrade the SDK or switch to MANAGED_AGENTS_MODE=auto.",
      );
    }
    return new ManagedAgentsRuntime(
      opts.client as unknown as ManagedAgentsClient,
      opts.modelId,
      opts.buzzCoordinator,
      { buzzTimeoutMs: opts.buzzTimeoutMs },
    );
  }

  // auto
  if (ManagedAgentsRuntime.isAvailable(opts.client)) {
    return new ManagedAgentsRuntime(
      opts.client as unknown as ManagedAgentsClient,
      opts.modelId,
      opts.buzzCoordinator,
      { buzzTimeoutMs: opts.buzzTimeoutMs },
    );
  }
  return new DirectSdkRuntime(
    opts.client,
    opts.modelId,
    opts.buzzCoordinator,
    { buzzTimeoutMs: opts.buzzTimeoutMs },
  );
}
