import { describe, test, expect } from "bun:test";
import { SqliteMemoryStore } from "./sqlite-store.ts";

async function freshStore() {
  // `:memory:` gives us a per-test ephemeral DB.
  return SqliteMemoryStore.open(":memory:");
}

describe("SqliteMemoryStore", () => {
  test("write then read returns value (string)", async () => {
    const s = await freshStore();
    s.write("s1", "alice", "name", "Alice");
    expect(s.read("s1", "alice", "name")).toBe("Alice");
    s.close();
  });

  test("write then read returns value (object)", async () => {
    const s = await freshStore();
    s.write("s1", "alice", "obj", { x: 1, y: [2, 3] });
    expect(s.read("s1", "alice", "obj")).toEqual({ x: 1, y: [2, 3] });
    s.close();
  });

  test("read of missing key is undefined", async () => {
    const s = await freshStore();
    expect(s.read("s1", "alice", "missing")).toBeUndefined();
    s.close();
  });

  test("namespaced by (session, seat)", async () => {
    const s = await freshStore();
    s.write("s1", "alice", "k", 1);
    s.write("s1", "bob", "k", 2);
    s.write("s2", "alice", "k", 99);
    expect(s.read("s1", "alice", "k")).toBe(1);
    expect(s.read("s1", "bob", "k")).toBe(2);
    expect(s.read("s2", "alice", "k")).toBe(99);
    s.close();
  });

  test("list returns sorted keys for namespace only", async () => {
    const s = await freshStore();
    s.write("s1", "alice", "b", 1);
    s.write("s1", "alice", "a", 2);
    s.write("s1", "bob", "c", 3);
    expect(s.list("s1", "alice")).toEqual(["a", "b"]);
    expect(s.list("s1", "bob")).toEqual(["c"]);
    s.close();
  });

  test("dump returns full namespace as object", async () => {
    const s = await freshStore();
    s.write("s1", "alice", "a", 1);
    s.write("s1", "alice", "b", { nested: true });
    expect(s.dump("s1", "alice")).toEqual({ a: 1, b: { nested: true } });
    s.close();
  });

  test("write upserts on conflict", async () => {
    const s = await freshStore();
    s.write("s1", "alice", "k", "v1");
    s.write("s1", "alice", "k", "v2");
    expect(s.read("s1", "alice", "k")).toBe("v2");
    s.close();
  });
});
