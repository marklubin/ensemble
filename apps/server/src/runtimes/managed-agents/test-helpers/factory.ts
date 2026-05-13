import type { ConformanceFactory } from "@ensemble/spi-conformance";
import { DirectSdkRuntime } from "../direct-sdk-runtime.ts";
import { FakeAnthropic, textStreamEvents, toolUseStreamEvents } from "./fake-anthropic.ts";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Factory passed to `runConformanceSuite`. Returns a fresh runtime
 * backed by a fresh FakeAnthropic per call so every test case sees
 * clean state. Default behavior: messages.create yields a small text
 * stream; calls 5-6 yield buzzer tool_use streams (for buzz_check cases).
 *
 * If Agent A hasn't filled in the 25 cases yet, `runConformanceSuite`
 * is a no-op and this skeleton-passes (per the brief).
 */
export const makeFixtureFactory: ConformanceFactory = async () => {
  const fake = new FakeAnthropic({
    inlineEvents: [
      textStreamEvents("Acknowledged. Proceeding."),
      textStreamEvents("Yes, I agree with the previous point."),
      textStreamEvents("Disagreeing politely here."),
      textStreamEvents("Reply to round 2 turn."),
      toolUseStreamEvents({
        toolName: "buzzer.press",
        toolInput: { intensity: 6, intent: "Want to add color", nonce: "AUTO" },
      }),
      toolUseStreamEvents({
        toolName: "buzzer.pass",
        toolInput: { reason: "nothing to add", nonce: "AUTO" },
      }),
      textStreamEvents("Followup turn."),
      textStreamEvents("Another response."),
      textStreamEvents("Yet another response."),
      textStreamEvents("Closing thoughts."),
    ],
  });

  const runtime = new DirectSdkRuntime(
    fake as unknown as Anthropic,
    "claude-fake-1",
  );

  return { runtime, fixtureMode: true };
};
