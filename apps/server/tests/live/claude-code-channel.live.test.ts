/**
 * L6 — live channel runtime smoke against a real Claude Code session.
 *
 * Gated by:
 *   - ENSEMBLE_TEST_MODE === "live"
 *   - `claude` binary present on PATH
 *
 * Setup:
 *   - Boot the in-process server with the channels WS route.
 *   - Spawn `claude --dangerously-load-development-channels server:ensemble`
 *     with a custom `.mcp.json` pointing at `bun apps/channel-bridge/src/index.ts`.
 *   - Drive a turn through `ChannelRuntime` and assert a non-empty reply.
 *
 * Status: SKIPPED.
 *   The channel protocol (`notifications/claude/channel`) is a
 *   research preview as of May 2026 and its exact request/response
 *   shape is still in flux. We ship the test scaffolding so it's
 *   ready to flip on once the protocol stabilizes. The L1/L2/L4
 *   tests cover correctness of our coordinator + runtime against the
 *   wire protocol we control.
 */

import { test } from "bun:test";

test.skip(
  "live: channel runtime against real Claude Code",
  () => {
    // Intentionally empty. See header comment for why this is skipped
    // and what the live wiring would look like.
  },
);
