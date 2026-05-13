/**
 * Self-test: run the conformance suite against a minimal reference
 * runtime that satisfies the SPI. If this passes, the suite is at
 * least internally consistent.
 *
 * The reference runtime here is a slimmed RecordedRuntime equivalent
 * (kept self-contained to avoid a cross-package import — the real
 * scheduler-side RecordedRuntime lives in apps/server).
 */

import type {
  BuzzResponse,
  Capability,
  InstanceHandle,
  PersonaRuntime,
  PersonaSpec,
  SessionContext,
  TurnEvent,
} from "@ensemble/shared";

import { MockHostApi } from "./mock-host-api.ts";
import { runConformanceSuite, type ConformanceFixture } from "./index.ts";

const CAPS: ReadonlySet<Capability> = new Set(["streaming", "buzz_check"]);

class ReferenceRuntime implements PersonaRuntime {
  readonly name = "reference";
  readonly defaultCapabilities = CAPS;
  private nextId = 0;

  async attach(_p: PersonaSpec, ctx: SessionContext): Promise<InstanceHandle> {
    return {
      id: `h${this.nextId++}`,
      seat_id: ctx.seat_id,
      capabilities: CAPS,
    };
  }

  async *takeTurn(
    handle: InstanceHandle,
    _events: TurnEvent[],
  ): AsyncIterable<string> {
    yield `<${handle.seat_id}:start>`;
    yield "..body..";
    yield `<${handle.seat_id}:end>`;
  }

  async buzzCheck(
    _handle: InstanceHandle,
    _recent: TurnEvent[],
  ): Promise<BuzzResponse> {
    return { score: 5, intent: "test buzz", can_pass: true };
  }

  async detach(_handle: InstanceHandle): Promise<void> {
    /* idempotent no-op */
  }
}

async function factory(): Promise<ConformanceFixture> {
  return {
    runtime: new ReferenceRuntime(),
    fixtureMode: true,
    hostApi: new MockHostApi(),
  };
}

runConformanceSuite("reference (self-test)", factory);
