import { describe, test, expect } from "bun:test";
import { MemoryStore } from "./store.ts";

describe("MemoryStore (in-memory)", () => {
  test("write then read returns value", () => {
    const m = new MemoryStore();
    m.write("s1", "alice", "name", "Alice");
    expect(m.read("s1", "alice", "name")).toBe("Alice");
  });

  test("read of missing key is undefined", () => {
    const m = new MemoryStore();
    expect(m.read("s1", "alice", "missing")).toBeUndefined();
  });

  test("namespaced by (session, seat) — cross-seat write does not leak", () => {
    const m = new MemoryStore();
    m.write("s1", "alice", "k", 1);
    m.write("s1", "bob", "k", 2);
    expect(m.read("s1", "alice", "k")).toBe(1);
    expect(m.read("s1", "bob", "k")).toBe(2);
  });

  test("namespaced by session too", () => {
    const m = new MemoryStore();
    m.write("s1", "alice", "k", "one");
    m.write("s2", "alice", "k", "two");
    expect(m.read("s1", "alice", "k")).toBe("one");
    expect(m.read("s2", "alice", "k")).toBe("two");
  });

  test("list returns keys for that namespace only", () => {
    const m = new MemoryStore();
    m.write("s1", "alice", "a", 1);
    m.write("s1", "alice", "b", 2);
    m.write("s1", "bob", "c", 3);
    expect(m.list("s1", "alice").sort()).toEqual(["a", "b"]);
    expect(m.list("s1", "bob")).toEqual(["c"]);
  });

  test("dump returns full namespace", () => {
    const m = new MemoryStore();
    m.write("s1", "alice", "a", 1);
    m.write("s1", "alice", "b", { nested: true });
    expect(m.dump("s1", "alice")).toEqual({ a: 1, b: { nested: true } });
  });

  test("write overwrites existing key", () => {
    const m = new MemoryStore();
    m.write("s1", "alice", "k", "v1");
    m.write("s1", "alice", "k", "v2");
    expect(m.read("s1", "alice", "k")).toBe("v2");
  });
});
