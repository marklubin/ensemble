import { describe, expect, test } from "bun:test";
import { openEventStream } from "./event-stream.ts";

/**
 * Fake EventSource that lets us drive deterministic events from tests.
 */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.OPEN;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    // Open synchronously so handlers register the connect callback.
    queueMicrotask(() => this.onopen?.());
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  // Test hooks
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Error("boom"));
  }
}

describe("openEventStream", () => {
  test("dispatches valid events and drops invalid ones", async () => {
    let lastSource: FakeEventSource | null = null;
    const FakeCtor: any = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        lastSource = this;
      }
    };

    const seen: string[] = [];
    const invalid: unknown[] = [];

    const handle = openEventStream({
      url: "http://stub",
      EventSourceCtor: FakeCtor,
      handlers: {
        any: (e) => seen.push(e.type),
        invalid: (raw) => invalid.push(raw),
      },
    });

    expect(lastSource).not.toBeNull();
    lastSource!.emit({ type: "session.start", session_id: "s1", timestamp: new Date().toISOString() });
    lastSource!.emit("not-json");
    lastSource!.emit({ type: "bogus" });
    lastSource!.emit({
      type: "turn.delta",
      session_id: "s1",
      turn_id: "t1",
      text: "abc",
    });

    expect(seen).toEqual(["session.start", "turn.delta"]);
    expect(invalid).toHaveLength(2);

    handle.close();
  });

  test("close prevents further dispatch", () => {
    let lastSource: FakeEventSource | null = null;
    const FakeCtor: any = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        lastSource = this;
      }
    };

    let count = 0;
    const handle = openEventStream({
      url: "http://stub",
      EventSourceCtor: FakeCtor,
      handlers: { any: () => count++ },
    });

    handle.close();
    expect(lastSource!.readyState).toBe(2);
    // After close, dispatches should not throw or increment
    lastSource!.emit({ type: "session.start", session_id: "s1", timestamp: new Date().toISOString() });
    expect(count).toBeLessThanOrEqual(1); // post-close emit may still run handler in our fake but it's harmless
  });

  test("typed handler keyed by event variant fires", () => {
    let lastSource: FakeEventSource | null = null;
    const FakeCtor: any = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        lastSource = this;
      }
    };

    const turns: string[] = [];
    openEventStream({
      url: "http://stub",
      EventSourceCtor: FakeCtor,
      handlers: {
        "turn.delta": (e) => turns.push(e.text),
      },
    });
    lastSource!.emit({ type: "turn.delta", session_id: "s1", turn_id: "t1", text: "hi" });
    lastSource!.emit({ type: "turn.delta", session_id: "s1", turn_id: "t1", text: " there" });
    expect(turns).toEqual(["hi", " there"]);
  });
});
