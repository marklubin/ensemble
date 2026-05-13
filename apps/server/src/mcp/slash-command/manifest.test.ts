/**
 * L1: validate that the slash command manifest is well-formed JSON
 * with the fields the install README promises.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;

describe("slash-command manifest", () => {
  const raw = readFileSync(join(HERE, "manifest.json"), "utf8");
  let manifest: Record<string, unknown>;

  test("parses as JSON", () => {
    expect(() => {
      manifest = JSON.parse(raw) as Record<string, unknown>;
    }).not.toThrow();
  });

  test("has the required top-level fields", () => {
    manifest = JSON.parse(raw) as Record<string, unknown>;
    expect(manifest.name).toBe("ensemble cast");
    expect(typeof manifest.description).toBe("string");
    expect(typeof manifest.version).toBe("string");
    expect(Array.isArray(manifest.arguments)).toBe(true);
  });

  test("declares the `persona` argument as required", () => {
    manifest = JSON.parse(raw) as Record<string, unknown>;
    const args = manifest.arguments as Array<{
      name: string;
      required?: boolean;
    }>;
    const persona = args.find((a) => a.name === "persona");
    expect(persona).toBeDefined();
    expect(persona?.required).toBe(true);
  });

  test("lists the Host API tools the slash command depends on", () => {
    manifest = JSON.parse(raw) as Record<string, unknown>;
    const mcp = manifest.mcp as { tools: string[] };
    expect(mcp.tools).toContain("buzzer.press");
    expect(mcp.tools).toContain("buzzer.pass");
    expect(mcp.tools).toContain("cast.list");
    expect(mcp.tools).toContain("round.info");
  });
});
