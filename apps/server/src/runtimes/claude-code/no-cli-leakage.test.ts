/**
 * Invariant test: only `local-cli-transport.ts` is allowed to import
 * subprocess primitives. Every other `.ts` file in this directory must
 * stay pure async TypeScript so the SPI conformance suite (and any
 * future in-process orchestration) never spawns processes.
 *
 * Hand-rolled to avoid pulling in a real linter.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ALLOWED_FILE = "local-cli-transport.ts";

// Patterns that indicate a file is reaching into subprocess machinery.
// Keep this list conservative — false positives are loud and easy to
// fix; false negatives defeat the invariant.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /from\s+["']child_process["']/,
  /from\s+["']node:child_process["']/,
  /require\(["']child_process["']\)/,
  /require\(["']node:child_process["']\)/,
  /\bBun\.spawn(?:Sync)?\b/,
  /\bnode:worker_threads\b/,
  /\bnode:cluster\b/,
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no-cli-leakage", () => {
  const files = listTsFiles(HERE);

  test("scope discovered at least the expected files", () => {
    const names = files.map((f) => f.replace(HERE, ""));
    // Sanity: we found ourselves and the allowed file.
    expect(names).toContain("no-cli-leakage.test.ts");
    expect(names).toContain(ALLOWED_FILE);
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    const rel = file.replace(HERE, "");
    if (rel === ALLOWED_FILE) continue;

    test(`${rel} does not import subprocess primitives`, () => {
      const content = readFileSync(file, "utf8");
      // Strip block + line comments so doc-strings that mention
      // `child_process` don't trip the check.
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(stripped).not.toMatch(pattern);
      }
    });
  }

  test(`${ALLOWED_FILE} actually uses subprocess primitives (otherwise it's dead code)`, () => {
    const content = readFileSync(join(HERE, ALLOWED_FILE), "utf8");
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const hits = FORBIDDEN_PATTERNS.filter((p) => p.test(stripped));
    expect(hits.length).toBeGreaterThan(0);
  });
});
