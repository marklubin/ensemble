/**
 * SPI Conformance Suite (Test Level L2).
 *
 * Every PersonaRuntime implementation must pass this. Each runtime
 * package exports a 2-line test file that invokes `runConformanceSuite`
 * with a factory that returns a runtime instance (typically backed by
 * fixtures so CI doesn't need live APIs).
 *
 *   // packages/runtime-managed-agents/test/conformance.test.ts
 *   import { runConformanceSuite } from "@ensemble/spi-conformance";
 *   import { makeFixtureFactory } from "./factory.ts";
 *   runConformanceSuite("managed-agents", makeFixtureFactory);
 *
 * Phase 0 ships this as a skeleton — the actual test cases are
 * implemented by the Scheduler agent (Phase 1A) and consumed by every
 * runtime agent.
 *
 * The 25 cases the agents will implement (see the plan):
 *   - Lifecycle (attach handle shape, parallel attach, idempotent detach, unknown handle)
 *   - Capability honesty (streaming yields ≥1 chunk, buzz_check vs. absent)
 *   - Streaming chunk shape (non-empty strings, consumable once, concat invariant)
 *   - Ordering (response references most-recent sentinel turn)
 *   - Tools end-to-end (memory.write/read round-trip via MCP)
 *   - buzzCheck scoring shape (Zod-validated, addressed-at-seat scoring)
 *   - Cancellation (early-break cleanup; follow-up takeTurn still works)
 *   - Error injection (tool errors propagate; mid-stream disconnect surfaces typed error)
 */

import type { PersonaRuntime } from "@ensemble/shared";

export interface ConformanceFactory {
  (): Promise<{
    runtime: PersonaRuntime;
    /** Whether this factory uses recorded fixtures (CI default) or live APIs. */
    fixtureMode: boolean;
  }>;
}

export interface ConformanceOptions {
  /** Skip live-only tests when this is true (CI default). */
  skipLive?: boolean;
}

/**
 * Top-level entry point. Phase 0 implementation is a placeholder; the
 * Scheduler agent in Phase 1 fills in the actual cases.
 */
export function runConformanceSuite(
  _runtimeName: string,
  _factory: ConformanceFactory,
  _opts: ConformanceOptions = {},
): void {
  // TODO(phase-1a): implement the 25 conformance cases from the plan.
  // For now this is a no-op so the package compiles and runtime
  // packages can wire up their conformance test file early.
}
