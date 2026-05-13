import { describe, expect, test } from "bun:test";
import { createUiBridgeClient } from "./ui-bridge-client.ts";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.OPEN;
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

describe("ui-bridge-client", () => {
  test("focus message gives the client a currentTurnId; chunks post that turn_id", async () => {
    let lastSource: FakeEventSource | null = null;
    const FakeCtor: any = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        lastSource = this;
      }
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const client = createUiBridgeClient({
      sessionId: "s1",
      seatId: "human",
      fetchImpl: fakeFetch,
      EventSourceCtor: FakeCtor,
    });

    expect(client.currentTurnId()).toBeNull();
    lastSource!.emit({ kind: "focus", seat_id: "human", turn_id: "t-42" });
    expect(client.currentTurnId()).toBe("t-42");

    await client.sendChunk("h");
    await client.sendChunk("i");
    await client.submit();

    expect(calls).toHaveLength(3);
    expect(calls[0]!.body).toMatchObject({ kind: "chunk", turn_id: "t-42", text: "h" });
    expect(calls[1]!.body).toMatchObject({ kind: "chunk", turn_id: "t-42", text: "i" });
    expect(calls[2]!.body).toMatchObject({ kind: "submit", turn_id: "t-42" });
    expect(client.currentTurnId()).toBeNull();
  });

  test("blur message clears focus", () => {
    let lastSource: FakeEventSource | null = null;
    const FakeCtor: any = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        lastSource = this;
      }
    };
    const client = createUiBridgeClient({
      sessionId: "s1",
      seatId: "human",
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
      EventSourceCtor: FakeCtor,
    });
    lastSource!.emit({ kind: "focus", seat_id: "human", turn_id: "t-42" });
    lastSource!.emit({ kind: "blur", seat_id: "human", turn_id: "t-42" });
    expect(client.currentTurnId()).toBeNull();
  });

  test("sendChunk no-ops when there's no active turn", async () => {
    const calls: any[] = [];
    const fakeFetch = (async (url: any, init?: any) => {
      calls.push({ url, init });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const client = createUiBridgeClient({
      sessionId: "s1",
      seatId: "human",
      fetchImpl: fakeFetch,
      // No EventSource ctor — onFocus won't fire.
      EventSourceCtor: undefined,
    });
    await client.sendChunk("x");
    expect(calls).toEqual([]);
  });
});
