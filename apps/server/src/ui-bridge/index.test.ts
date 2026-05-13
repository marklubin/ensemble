/**
 * L1 — UiBridge buffering + cancellation + multi-turn isolation.
 */
import { describe, expect, test } from "bun:test";
import { UiBridge } from "./index.ts";
import type { UiBridgeMessage } from "@ensemble/shared";

function chunk(seat_id: string, turn_id: string, text: string): UiBridgeMessage {
  return { kind: "chunk", seat_id, turn_id, text };
}
function submit(seat_id: string, turn_id: string): UiBridgeMessage {
  return { kind: "submit", seat_id, turn_id };
}
function cancel(seat_id: string, turn_id: string, reason?: string): UiBridgeMessage {
  return { kind: "cancel", seat_id, turn_id, reason };
}

async function drain(it: AsyncIterable<UiBridgeMessage>): Promise<UiBridgeMessage[]> {
  const out: UiBridgeMessage[] = [];
  for await (const m of it) out.push(m);
  return out;
}

describe("UiBridge inbound", () => {
  test("buffers messages received before the consumer iterates", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    const iter = b.inboundFor("s1", "seat-a", "t1");
    expect(b.ingest(chunk("seat-a", "t1", "hi"), "s1")).toBe(true);
    expect(b.ingest(chunk("seat-a", "t1", " there"), "s1")).toBe(true);
    expect(b.ingest(submit("seat-a", "t1"), "s1")).toBe(true);
    const got = await drain(iter);
    expect(got.map((m) => (m.kind === "chunk" ? m.text : m.kind))).toEqual([
      "hi",
      " there",
      "submit",
    ]);
  });

  test("submit closes the iterable cleanly", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    const iter = b.inboundFor("s1", "seat-a", "t1");
    queueMicrotask(() => {
      b.ingest(chunk("seat-a", "t1", "x"), "s1");
      b.ingest(submit("seat-a", "t1"), "s1");
    });
    const got = await drain(iter);
    expect(got).toHaveLength(2);
    // Posting after submit is rejected (no active turn).
    expect(b.ingest(chunk("seat-a", "t1", "late"), "s1")).toBe(false);
  });

  test("cancel closes the iterable and rejects further posts", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    const iter = b.inboundFor("s1", "seat-a", "t1");
    queueMicrotask(() => {
      b.ingest(chunk("seat-a", "t1", "x"), "s1");
      b.ingest(cancel("seat-a", "t1", "user left"), "s1");
    });
    const got = await drain(iter);
    expect(got).toHaveLength(2);
    expect(b.ingest(chunk("seat-a", "t1", "late"), "s1")).toBe(false);
  });

  test("messages tagged with the wrong turn_id are not routed", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    b.inboundFor("s1", "seat-a", "t1");
    expect(b.ingest(chunk("seat-a", "t-other", "nope"), "s1")).toBe(false);
  });

  test("messages for an unregistered seat are rejected", () => {
    const b = new UiBridge();
    expect(b.ingest(chunk("seat-x", "t1", "x"), "s1")).toBe(false);
  });

  test("two turns on the same seat don't cross-contaminate", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");

    // First turn
    const it1 = b.inboundFor("s1", "seat-a", "t1");
    b.ingest(chunk("seat-a", "t1", "first"), "s1");
    b.ingest(submit("seat-a", "t1"), "s1");
    const got1 = await drain(it1);
    expect(got1.filter((m) => m.kind === "chunk")).toHaveLength(1);

    // Second turn — fresh queue, must not contain anything from turn 1
    const it2 = b.inboundFor("s1", "seat-a", "t2");
    b.ingest(chunk("seat-a", "t2", "second"), "s1");
    b.ingest(submit("seat-a", "t2"), "s1");
    const got2 = await drain(it2);
    expect(got2.filter((m) => m.kind === "chunk").map((m) => (m as { text: string }).text))
      .toEqual(["second"]);
  });

  test("starting a new turn supersedes a stale in-flight turn", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    const stale = b.inboundFor("s1", "seat-a", "t-old");
    // Starting t-new should cancel t-old.
    const fresh = b.inboundFor("s1", "seat-a", "t-new");
    const staleGot = await drain(stale);
    expect(staleGot).toHaveLength(0);
    b.ingest(chunk("seat-a", "t-new", "ok"), "s1");
    b.ingest(submit("seat-a", "t-new"), "s1");
    const freshGot = await drain(fresh);
    expect(freshGot).toHaveLength(2);
  });

  test("unregister closes any in-flight turn", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    const iter = b.inboundFor("s1", "seat-a", "t1");
    b.unregister("s1", "seat-a");
    const got = await drain(iter);
    expect(got).toHaveLength(0);
  });

  test("inboundFor on unregistered seat throws", () => {
    const b = new UiBridge();
    expect(() => b.inboundFor("s1", "missing", "t1")).toThrow();
  });
});

describe("UiBridge outbound", () => {
  test("emitFocus before any subscriber buffers, then flushes on subscribe", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a", "Alice");
    b.emitFocus("s1", "seat-a", "t1");
    b.emitBlur("s1", "seat-a", "t1");

    // Drive the SSE route via the Hono app and read the response body.
    const res = await b.routes.request("/events?session_id=s1&seat_id=seat-a");
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    // Read enough chunks to see ready+focus+blur, then cancel.
    let safety = 0;
    while (safety++ < 10 && (!acc.includes("event: focus") || !acc.includes("event: blur"))) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value);
    }
    await reader.cancel();
    expect(acc).toContain("event: ready");
    expect(acc).toContain("event: focus");
    expect(acc).toContain("event: blur");
    expect(acc).toContain("Alice");
  });

  test("HTTP POST /messages routes into the inbound queue", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    const iter = b.inboundFor("s1", "seat-a", "t1");

    const res = await b.routes.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "s1",
        message: chunk("seat-a", "t1", "hello"),
      }),
    });
    expect(res.status).toBe(200);

    const res2 = await b.routes.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "s1",
        message: submit("seat-a", "t1"),
      }),
    });
    expect(res2.status).toBe(200);

    const got = await drain(iter);
    expect(got).toHaveLength(2);
  });

  test("HTTP POST with invalid payload returns 400", async () => {
    const b = new UiBridge();
    const res = await b.routes.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  test("HTTP POST for inactive seat-turn returns 409", async () => {
    const b = new UiBridge();
    b.register("s1", "seat-a");
    // No inboundFor called — no active turn.
    const res = await b.routes.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "s1",
        message: chunk("seat-a", "t1", "x"),
      }),
    });
    expect(res.status).toBe(409);
  });

  test("GET /events for an unregistered seat returns 404", async () => {
    const b = new UiBridge();
    const res = await b.routes.request("/events?session_id=s1&seat_id=missing");
    expect(res.status).toBe(404);
  });

  test("GET /events without query params returns 400", async () => {
    const b = new UiBridge();
    const res = await b.routes.request("/events");
    expect(res.status).toBe(400);
  });
});
