/**
 * L1 unit tests for ChannelCoordinator. Uses an in-memory
 * ChannelConnection fake; no real WebSocket involved.
 *
 * Cases:
 *   - register accepts valid token; rejects invalid
 *   - double-register supersedes the first connection
 *   - sendTurnPrompt yields chunks and completes on done=true
 *   - WS disconnect rejects pending dispatches
 *   - send before register: rejects with not-connected error
 *   - timeout: dispatch fails with ChannelTimeoutError
 *   - unregister closes the channel cleanly
 */

import { describe, expect, test } from "bun:test";
import {
  ChannelCoordinator,
  ChannelDisconnectedError,
  ChannelNotConnectedError,
  ChannelTimeoutError,
  type ChannelConnection,
  type ReplyChunk,
} from "./coordinator.ts";

// ─── test fake ────────────────────────────────────────────────────────

class FakeConnection implements ChannelConnection {
  public sent: string[] = [];
  public closed: { code?: number; reason?: string } | null = null;
  private msgHandler: ((p: string) => void) | null = null;
  private closeHandler: ((info: { code?: number; reason?: string }) => void) | null = null;

  send(payload: string): void {
    if (this.closed) throw new Error("send after close");
    this.sent.push(payload);
  }
  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    this.closeHandler?.({ code, reason });
  }
  onMessage(h: (p: string) => void): void {
    this.msgHandler = h;
  }
  onClose(h: (info: { code?: number; reason?: string }) => void): void {
    this.closeHandler = h;
  }

  // ─── test helpers ────────────────────────────────────────────────
  receive(msg: object): void {
    this.msgHandler?.(JSON.stringify(msg));
  }
  receiveRaw(payload: string): void {
    this.msgHandler?.(payload);
  }
  drop(): void {
    this.close(1006, "network drop");
  }
  lastSent(): unknown {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

// ─── tests ────────────────────────────────────────────────────────────

describe("ChannelCoordinator — registration", () => {
  test("register with valid token succeeds and acks", () => {
    const c = new ChannelCoordinator({ validateToken: (t) => t === "good" });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "good");
    conn.receive({ type: "register", session_id: "S1", seat_id: "seat-1" });

    expect(c.isConnected("S1", "seat-1")).toBe(true);
    expect(conn.lastSent()).toMatchObject({
      type: "registered",
      session_id: "S1",
      seat_id: "seat-1",
    });
  });

  test("register with invalid token is rejected and connection closed", () => {
    const c = new ChannelCoordinator({ validateToken: (t) => t === "good" });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "bad");

    expect(conn.closed?.code).toBe(4401);
    // Cannot register after close.
    conn.receive({ type: "register", session_id: "S1", seat_id: "seat-1" });
    expect(c.isConnected("S1", "seat-1")).toBe(false);
  });

  test("register with missing token is rejected when validator requires one", () => {
    const c = new ChannelCoordinator({ validateToken: (t) => t === "good" });
    const conn = new FakeConnection();
    c.acceptConnection(conn, undefined);
    expect(conn.closed?.code).toBe(4401);
  });

  test("double-register for same (session, seat) supersedes the first", () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const first = new FakeConnection();
    const second = new FakeConnection();

    c.acceptConnection(first, "any");
    first.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    c.acceptConnection(second, "any");
    second.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    expect(c.isConnected("S", "seat-1")).toBe(true);
    expect(first.closed?.reason).toBe("superseded");
    // first received both a "registered" ack and the "superseded" notice
    expect(first.sent.map((s) => JSON.parse(s).type)).toContain("superseded");
    expect(second.closed).toBeNull();
  });

  test("malformed message produces an error frame but does not close", () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");

    conn.receiveRaw("{ not json");
    expect(conn.closed).toBeNull();
    expect(JSON.parse(conn.sent[conn.sent.length - 1]!).type).toBe("error");
  });

  test("reply before register is an error", () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "reply", turn_id: "t1", content: "hi", done: true });

    expect(JSON.parse(conn.sent[conn.sent.length - 1]!).type).toBe("error");
  });
});

describe("ChannelCoordinator — dispatch", () => {
  test("sendTurnPrompt before register yields a typed error", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const iter = c.sendTurnPrompt("S", "seat-1", "hello", "t-1");
    await expect(collect(iter)).rejects.toBeInstanceOf(ChannelNotConnectedError);
  });

  test("sendTurnPrompt sends a turn-prompt over the wire and streams replies until done", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    const iter = c.sendTurnPrompt("S", "seat-1", "the prompt", "t-1", { foo: 1 });

    // The coordinator should have sent the turn-prompt frame.
    const sentMsgs = conn.sent.map((s) => JSON.parse(s));
    const turnPrompt = sentMsgs.find((m) => m.type === "turn-prompt");
    expect(turnPrompt).toMatchObject({
      type: "turn-prompt",
      turn_id: "t-1",
      prompt: "the prompt",
      meta: { foo: 1 },
    });

    // Drive replies asynchronously while we collect.
    queueMicrotask(() => {
      conn.receive({ type: "reply", turn_id: "t-1", content: "chunk1", done: false });
      conn.receive({ type: "reply", turn_id: "t-1", content: "chunk2", done: false });
      conn.receive({ type: "reply", turn_id: "t-1", content: "chunk3", done: true });
    });

    const chunks: ReplyChunk[] = await collect(iter);
    expect(chunks.map((c) => c.content)).toEqual(["chunk1", "chunk2", "chunk3"]);
    expect(chunks[chunks.length - 1]!.done).toBe(true);
  });

  test("reply with unknown turn_id is silently ignored", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    const iter = c.sendTurnPrompt("S", "seat-1", "p", "t-real");
    queueMicrotask(() => {
      conn.receive({ type: "reply", turn_id: "t-unknown", content: "nope", done: true });
      conn.receive({ type: "reply", turn_id: "t-real", content: "yes", done: true });
    });
    const chunks = await collect(iter);
    expect(chunks.map((c) => c.content)).toEqual(["yes"]);
  });

  test("WS disconnect rejects pending dispatches with ChannelDisconnectedError", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    const iter = c.sendTurnPrompt("S", "seat-1", "p", "t-1");
    const consumer = collect(iter);
    queueMicrotask(() => conn.drop());

    await expect(consumer).rejects.toBeInstanceOf(ChannelDisconnectedError);
    expect(c.isConnected("S", "seat-1")).toBe(false);
  });

  test("timeout fails the dispatch with ChannelTimeoutError", async () => {
    const c = new ChannelCoordinator({
      validateToken: () => true,
      defaultDispatchTimeoutMs: 30,
    });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    const iter = c.sendTurnPrompt("S", "seat-1", "p", "t-1");
    await expect(collect(iter)).rejects.toBeInstanceOf(ChannelTimeoutError);
  });

  test("concurrent dispatches are routed by turn_id", async () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    const a = c.sendTurnPrompt("S", "seat-1", "p1", "ta");
    const b = c.sendTurnPrompt("S", "seat-1", "p2", "tb");

    queueMicrotask(() => {
      conn.receive({ type: "reply", turn_id: "tb", content: "B", done: true });
      conn.receive({ type: "reply", turn_id: "ta", content: "A", done: true });
    });

    const [resA, resB] = await Promise.all([collect(a), collect(b)]);
    expect(resA.map((c) => c.content)).toEqual(["A"]);
    expect(resB.map((c) => c.content)).toEqual(["B"]);
  });
});

describe("ChannelCoordinator — unregister", () => {
  test("unregister closes the connection and clears state", () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    const conn = new FakeConnection();
    c.acceptConnection(conn, "tok");
    conn.receive({ type: "register", session_id: "S", seat_id: "seat-1" });

    c.unregister("S", "seat-1");
    expect(conn.closed?.reason).toBe("detached");
    expect(c.isConnected("S", "seat-1")).toBe(false);
  });

  test("unregister on unknown seat is a no-op", () => {
    const c = new ChannelCoordinator({ validateToken: () => true });
    expect(() => c.unregister("nope", "nope")).not.toThrow();
  });
});
