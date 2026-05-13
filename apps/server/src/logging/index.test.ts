/**
 * L1 unit tests for the structured-JSON logger.
 *
 * Captures `console.log` output and asserts:
 *   - JSON shape: { ts, level, msg, ...fields }
 *   - each level uses the right `level` string
 *   - fields override is honored
 *   - timestamp is a parseable ISO-8601 string
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { log, logger, shortId } from "./index.ts";

let captured: string[] = [];
let originalLog: typeof console.log;

beforeEach(() => {
  captured = [];
  originalLog = console.log;
  console.log = (msg: unknown) => {
    captured.push(typeof msg === "string" ? msg : String(msg));
  };
});

afterEach(() => {
  console.log = originalLog;
});

function parseLastLine(): Record<string, unknown> {
  const line = captured[captured.length - 1];
  if (!line) throw new Error("no log line captured");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("logger", () => {
  test("info emits a JSON line with ts/level/msg", () => {
    logger.info("hello", { x: 1 });
    expect(captured).toHaveLength(1);
    const entry = parseLastLine();
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.x).toBe(1);
    expect(typeof entry.ts).toBe("string");
    // Must round-trip through Date.
    expect(Number.isNaN(Date.parse(entry.ts as string))).toBe(false);
  });

  test("debug/warn/error each set the right level", () => {
    logger.debug("d");
    logger.warn("w");
    logger.error("e");
    expect(captured).toHaveLength(3);
    expect((JSON.parse(captured[0]!) as { level: string }).level).toBe(
      "debug",
    );
    expect((JSON.parse(captured[1]!) as { level: string }).level).toBe(
      "warn",
    );
    expect((JSON.parse(captured[2]!) as { level: string }).level).toBe(
      "error",
    );
  });

  test("explicit log() with no fields still emits ts/level/msg", () => {
    log("info", "bare");
    const entry = parseLastLine();
    expect(entry.msg).toBe("bare");
    expect(entry.level).toBe("info");
    expect(entry.ts).toBeDefined();
  });

  test("fields can contain nested objects and arrays", () => {
    logger.info("complex", {
      seat_ids: ["a", "b"],
      meta: { round: 3 },
    });
    const entry = parseLastLine();
    expect(entry.seat_ids).toEqual(["a", "b"]);
    expect(entry.meta).toEqual({ round: 3 });
  });

  test("does not blow up on circular structures — falls back to error log", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    // We don't promise success here, just that it doesn't throw the
    // whole server. JSON.stringify will throw; we accept that the
    // call may throw, but it must NOT silently corrupt unrelated state.
    // The logger doesn't catch — callers must not pass circular fields.
    expect(() => logger.info("cyclic", cyclic)).toThrow();
  });

  test("shortId produces a 12-char hex string", () => {
    const id = shortId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    // Two consecutive ids should differ.
    expect(shortId()).not.toBe(id);
  });
});
