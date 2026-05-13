import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal fake of the slice of `@anthropic-ai/sdk` our adapter uses.
 *
 * Covers two surfaces:
 *
 *   1. `messages.create({...stream: true})` → AsyncIterable of stream events
 *      (this is what DirectSdkRuntime hits)
 *   2. `beta.managedAgents.*` (managed-agents path) — present as stubs so
 *      the auto-detector decides quickly. By default these throw a
 *      "not available" error; tests can override via `enableManagedAgents`.
 *
 * Fixtures: JSONL files where each line is one stream event. Each call to
 * `messages.create` reads the next fixture indexed by `(fixtureKey, callIndex)`.
 * If `replyOverride` is set, that string is streamed instead of reading
 * from disk (handy for the buzz-check tests where we synthesize a tool_use).
 */

export interface FakeStreamEvent {
  type: string;
  // structural fields vary by type; keep loose
  // typed via `RawMessageStreamEvent` shape on the real SDK
  [k: string]: unknown;
}

export interface FakeAnthropicOptions {
  /** Map of (fixtureKey → JSONL path). callIndex appends "-NNN" if multi. */
  fixtures?: Record<string, string>;
  /** Directory containing fixture JSONLs (resolved against process cwd). */
  fixturesDir?: string;
  /** If true, the beta.managedAgents path is "available" (default: false). */
  enableManagedAgents?: boolean;
  /** Inline event overrides keyed by call sequence (1-based). */
  inlineEvents?: FakeStreamEvent[][];
  /** Throw on the Nth messages.create call (1-based) — for error injection. */
  throwOnCall?: number;
  /** Throw mid-stream after N events on the Nth call. */
  throwMidStreamOnCall?: { call: number; afterEvents: number };
}

/** Make a basic text-only stream: start → block_start → deltas → block_stop → message_stop. */
export function textStreamEvents(text: string): FakeStreamEvent[] {
  // Split into roughly 8-char chunks so streaming feels real.
  const chunks: string[] = [];
  if (text.length === 0) {
    chunks.push("");
  } else {
    for (let i = 0; i < text.length; i += 8) {
      chunks.push(text.slice(i, i + 8));
    }
  }
  return [
    { type: "message_start", message: { id: "msg_fake", role: "assistant" } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    ...chunks.map((c) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: c },
    })),
    { type: "content_block_stop", index: 0 },
    { type: "message_stop" },
  ];
}

/** Build a tool_use streaming sequence (used by buzz-check fixtures). */
export function toolUseStreamEvents(args: {
  toolName: string;
  toolInput: Record<string, unknown>;
}): FakeStreamEvent[] {
  return [
    { type: "message_start", message: { id: "msg_fake", role: "assistant" } },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "toolu_fake",
        name: args.toolName,
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(args.toolInput) },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
}

export class FakeAnthropic {
  // Call log for tests to assert
  readonly calls: Array<{
    api: "messages.create" | "managed_agents.create" | "managed_agents.archive";
    body: unknown;
  }> = [];

  private callIndex = 0;
  private opts: FakeAnthropicOptions;

  // Surface area used by adapters:
  readonly messages: {
    create: (body: unknown) => Promise<AsyncIterable<FakeStreamEvent>> | AsyncIterable<FakeStreamEvent>;
  };
  readonly beta: {
    managedAgents?: {
      sessions: {
        create: (body: unknown) => Promise<{ id: string }>;
        events: {
          create: (body: unknown) => AsyncIterable<FakeStreamEvent>;
        };
        archive: (body: unknown) => Promise<void>;
      };
    };
  };

  constructor(opts: FakeAnthropicOptions = {}) {
    this.opts = opts;

    this.messages = {
      create: (body: unknown) => {
        this.callIndex += 1;
        this.calls.push({ api: "messages.create", body });
        const idx = this.callIndex;

        if (this.opts.throwOnCall === idx) {
          throw new Error(`FakeAnthropic: injected error on call ${idx}`);
        }

        const events = this.eventsForCall(idx);
        const throwAfter =
          this.opts.throwMidStreamOnCall?.call === idx
            ? this.opts.throwMidStreamOnCall.afterEvents
            : -1;

        return makeAsyncIterable(events, throwAfter);
      },
    };

    if (opts.enableManagedAgents) {
      this.beta = {
        managedAgents: {
          sessions: {
            create: async (body) => {
              this.calls.push({ api: "managed_agents.create", body });
              return { id: `ma_session_${this.calls.length}` };
            },
            events: {
              create: (body) => {
                this.callIndex += 1;
                this.calls.push({ api: "messages.create", body });
                return makeAsyncIterable(this.eventsForCall(this.callIndex), -1);
              },
            },
            archive: async (body) => {
              this.calls.push({ api: "managed_agents.archive", body });
            },
          },
        },
      };
    } else {
      this.beta = {};
    }
  }

  private eventsForCall(idx: number): FakeStreamEvent[] {
    // Priority 1: inline events for this call index
    if (this.opts.inlineEvents && this.opts.inlineEvents[idx - 1]) {
      return this.opts.inlineEvents[idx - 1]!;
    }
    // Priority 2: try `call-{idx}.jsonl` in fixtures dir
    if (this.opts.fixturesDir) {
      const p = join(this.opts.fixturesDir, `call-${idx}.jsonl`);
      if (existsSync(p)) return readJsonl(p);
    }
    // Priority 3: named fixture (first one)
    const fixtures = this.opts.fixtures;
    if (fixtures) {
      const keys = Object.keys(fixtures);
      const key = keys[Math.min(idx - 1, keys.length - 1)];
      if (key) {
        const p = fixtures[key]!;
        if (existsSync(p)) return readJsonl(p);
      }
    }
    // Default fallback: a one-line "ok" stream
    return textStreamEvents("ok");
  }

  reset(): void {
    this.callIndex = 0;
    this.calls.length = 0;
  }
}

function readJsonl(path: string): FakeStreamEvent[] {
  const text = readFileSync(path, "utf-8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as FakeStreamEvent);
}

async function* makeAsyncIterable(
  events: FakeStreamEvent[],
  throwAfter: number,
): AsyncIterable<FakeStreamEvent> {
  let i = 0;
  for (const ev of events) {
    if (throwAfter >= 0 && i >= throwAfter) {
      throw new Error("FakeAnthropic: mid-stream disconnect (injected)");
    }
    yield ev;
    i += 1;
  }
}
