import { describe, test, expect } from "bun:test";
import { issue, verify, InvalidTokenError, hasClaim } from "./jwt.ts";

const SECRET = "test-secret-at-least-sixteen-chars";

describe("jwt", () => {
  test("issue + verify round-trip", () => {
    const token = issue(
      { session_id: "s1", seat_id: "alice", claims: ["moderator"] },
      SECRET,
    );
    const payload = verify(token, SECRET);
    expect(payload.session_id).toBe("s1");
    expect(payload.seat_id).toBe("alice");
    expect(payload.claims).toEqual(["moderator"]);
    expect(hasClaim(payload, "moderator")).toBe(true);
    expect(hasClaim(payload, "admin")).toBe(false);
  });

  test("tampered signature is rejected", () => {
    const token = issue(
      { session_id: "s1", seat_id: "a", claims: [] },
      SECRET,
    );
    const tampered = `${token.slice(0, -3)}xxx`;
    expect(() => verify(tampered, SECRET)).toThrow(InvalidTokenError);
  });

  test("tampered payload is rejected (signature mismatch)", () => {
    const token = issue(
      { session_id: "s1", seat_id: "alice", claims: [] },
      SECRET,
    );
    // Re-encode the payload with elevated claims but keep the old sig.
    const [h, _b, s] = token.split(".") as [string, string, string];
    const evilPayload = Buffer.from(
      JSON.stringify({
        session_id: "s1",
        seat_id: "alice",
        claims: ["moderator"],
        iat: 0,
      }),
    )
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const evil = `${h}.${evilPayload}.${s}`;
    expect(() => verify(evil, SECRET)).toThrow(InvalidTokenError);
  });

  test("wrong secret is rejected", () => {
    const token = issue(
      { session_id: "s1", seat_id: "a", claims: [] },
      SECRET,
    );
    expect(() => verify(token, "different-secret-also-sixteen")).toThrow(
      InvalidTokenError,
    );
  });

  test("expired token is rejected", async () => {
    const token = issue(
      { session_id: "s1", seat_id: "a", claims: [], ttlSeconds: 1 },
      SECRET,
    );
    // Sleep just over the TTL.
    await new Promise((r) => setTimeout(r, 1100));
    expect(() => verify(token, SECRET)).toThrow(InvalidTokenError);
  });

  test("malformed token is rejected", () => {
    expect(() => verify("not-a-token", SECRET)).toThrow(InvalidTokenError);
    expect(() => verify("a.b", SECRET)).toThrow(InvalidTokenError);
  });

  test("missing claim is reflected by hasClaim", () => {
    const token = issue(
      { session_id: "s1", seat_id: "a", claims: ["reader"] },
      SECRET,
    );
    const payload = verify(token, SECRET);
    expect(hasClaim(payload, "moderator")).toBe(false);
    expect(hasClaim(payload, "reader")).toBe(true);
  });
});
