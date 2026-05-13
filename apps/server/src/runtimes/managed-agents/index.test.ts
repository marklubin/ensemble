import { describe, test, expect } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createManagedAgentsRuntime,
  ManagedAgentsRuntime,
  DirectSdkRuntime,
} from "./index.ts";
import { FakeAnthropic } from "./test-helpers/fake-anthropic.ts";

describe("createManagedAgentsRuntime auto-detect", () => {
  test("auto mode picks ManagedAgentsRuntime when beta is available", () => {
    const fake = new FakeAnthropic({ enableManagedAgents: true });
    const rt = createManagedAgentsRuntime({
      client: fake as unknown as Anthropic,
      modelId: "m",
      mode: "auto",
    });
    expect(rt).toBeInstanceOf(ManagedAgentsRuntime);
    expect(rt.name).toBe("managed-agents");
  });

  test("auto mode falls back to DirectSdkRuntime when beta is absent", () => {
    const fake = new FakeAnthropic({ enableManagedAgents: false });
    const rt = createManagedAgentsRuntime({
      client: fake as unknown as Anthropic,
      modelId: "m",
      mode: "auto",
    });
    expect(rt).toBeInstanceOf(DirectSdkRuntime);
    expect(rt.name).toBe("managed-agents"); // same registry slot
  });

  test("direct mode always returns DirectSdkRuntime", () => {
    const fake = new FakeAnthropic({ enableManagedAgents: true });
    const rt = createManagedAgentsRuntime({
      client: fake as unknown as Anthropic,
      modelId: "m",
      mode: "direct",
    });
    expect(rt).toBeInstanceOf(DirectSdkRuntime);
  });

  test("managed mode throws when beta is absent", () => {
    const fake = new FakeAnthropic({ enableManagedAgents: false });
    expect(() =>
      createManagedAgentsRuntime({
        client: fake as unknown as Anthropic,
        modelId: "m",
        mode: "managed",
      }),
    ).toThrow(/does not expose beta.managedAgents/);
  });
});
