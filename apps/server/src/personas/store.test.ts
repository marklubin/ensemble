import { describe, test, expect } from "bun:test";
import { InMemoryPersonaStore } from "./store.ts";
import type { PersonaSpec } from "@ensemble/shared";

const sample: PersonaSpec = {
  id: "x",
  name: "X",
  system_prompt: "be X",
  tools_allowed: [],
  memory_policy: "ephemeral",
};

describe("InMemoryPersonaStore", () => {
  test("put / get / list", () => {
    const s = new InMemoryPersonaStore();
    s.put(sample);
    expect(s.get("x")?.name).toBe("X");
    expect(s.list().length).toBe(1);
  });

  test("delete returns true on hit, false on miss", () => {
    const s = new InMemoryPersonaStore();
    s.put(sample);
    expect(s.delete("x")).toBe(true);
    expect(s.delete("x")).toBe(false);
    expect(s.list().length).toBe(0);
  });

  test("upsert overwrites", () => {
    const s = new InMemoryPersonaStore();
    s.put(sample);
    s.put({ ...sample, name: "X2" });
    expect(s.get("x")?.name).toBe("X2");
    expect(s.list().length).toBe(1);
  });
});
