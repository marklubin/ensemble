import { describe, test, expect, beforeEach } from "bun:test";
import {
  _resetForTests,
  getLogsSince,
  recordLog,
  ringBufferEnabled,
  clearLogs,
} from "./ring-buffer.ts";

describe("ring buffer", () => {
  beforeEach(() => _resetForTests(5));

  test("enabled when capacity > 0", () => {
    expect(ringBufferEnabled()).toBe(true);
  });

  test("records and retrieves all", () => {
    recordLog({ ts: "2026-01-01T00:00:00Z", level: "info", msg: "a" });
    recordLog({ ts: "2026-01-01T00:00:01Z", level: "info", msg: "b" });
    expect(getLogsSince(undefined)).toHaveLength(2);
  });

  test("since filter respects ISO ordering", () => {
    recordLog({ ts: "2026-01-01T00:00:00Z", level: "info", msg: "early" });
    recordLog({ ts: "2026-01-01T00:00:10Z", level: "info", msg: "late" });
    const got = getLogsSince("2026-01-01T00:00:05Z");
    expect(got.map((l) => l.msg)).toEqual(["late"]);
  });

  test("evicts oldest beyond capacity", () => {
    for (let i = 0; i < 10; i++) {
      recordLog({ ts: `2026-01-01T00:00:0${i}Z`, level: "info", msg: `m${i}` });
    }
    const all = getLogsSince(undefined);
    expect(all).toHaveLength(5);
    expect(all[0]!.msg).toBe("m5");
    expect(all[4]!.msg).toBe("m9");
  });

  test("clear empties the buffer", () => {
    recordLog({ ts: "2026-01-01T00:00:00Z", level: "info", msg: "x" });
    clearLogs();
    expect(getLogsSince(undefined)).toHaveLength(0);
  });

  test("disabled when capacity = 0 (production default)", () => {
    _resetForTests(0);
    expect(ringBufferEnabled()).toBe(false);
    recordLog({ ts: "2026-01-01T00:00:00Z", level: "info", msg: "drop" });
    expect(getLogsSince(undefined)).toHaveLength(0);
  });
});
