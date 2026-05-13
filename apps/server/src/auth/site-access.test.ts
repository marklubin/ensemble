/**
 * Site-access gate integration tests. The gate is a Hono middleware
 * that runs before everything except /health, /assets/*, etc.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { siteAccessGate } from "./site-access.ts";

function makeApp(key?: string): Hono {
  const original = process.env.SITE_ACCESS_KEY;
  if (key !== undefined) process.env.SITE_ACCESS_KEY = key;
  else delete process.env.SITE_ACCESS_KEY;
  const app = new Hono();
  app.use("*", siteAccessGate());
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/sessions", (c) => c.json({ ok: true, route: "sessions" }));
  app.get("/", (c) => c.html("<h1>App</h1>"));
  app.get("/assets/foo.js", (c) => c.text("/* asset */"));
  return Object.assign(app, { _origKey: original });
}

describe("siteAccessGate", () => {
  let origKey: string | undefined;

  beforeEach(() => {
    origKey = process.env.SITE_ACCESS_KEY;
  });

  afterEach(() => {
    if (origKey === undefined) delete process.env.SITE_ACCESS_KEY;
    else process.env.SITE_ACCESS_KEY = origKey;
  });

  test("no-op when SITE_ACCESS_KEY is unset", async () => {
    const app = makeApp(undefined);
    const r = await app.request("/sessions");
    expect(r.status).toBe(200);
  });

  test("blocks API without cookie or key", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/sessions", {
      headers: { accept: "application/json" },
    });
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  test("serves HTML login page for browser nav without key", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(r.status).toBe(401);
    const body = await r.text();
    expect(body).toContain("Access required");
    expect(body).toContain('<input name="key"');
  });

  test("/health bypasses the gate", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/health");
    expect(r.status).toBe(200);
  });

  test("/assets/* bypasses the gate", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/assets/foo.js");
    expect(r.status).toBe(200);
  });

  test("valid ?key= sets cookie and redirects (302)", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/?key=secret-123");
    expect(r.status).toBe(302);
    const setCookie = r.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ensemble_access=secret-123");
    expect(r.headers.get("location")).toBe("/");
  });

  test("wrong ?key= is rejected", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/?key=wrong", {
      headers: { accept: "text/html" },
    });
    expect(r.status).toBe(401);
  });

  test("valid cookie lets request through", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/sessions", {
      headers: {
        accept: "application/json",
        cookie: "ensemble_access=secret-123",
      },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.route).toBe("sessions");
  });

  test("wrong cookie still blocked", async () => {
    const app = makeApp("secret-123");
    const r = await app.request("/sessions", {
      headers: {
        accept: "application/json",
        cookie: "ensemble_access=bogus",
      },
    });
    expect(r.status).toBe(401);
  });
});
