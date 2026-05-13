/**
 * Site-wide access gate. A single static key in `SITE_ACCESS_KEY`
 * controls who can reach the app. Wrong key / no key → tiny login
 * page (HTML) or 401 JSON (API). The key is stored client-side as
 * `ensemble_access` cookie after successful login.
 *
 * Public paths (no gate):
 *   - GET /health                 — Fly's healthcheck must reach this
 *   - GET /__login                 — the login form itself
 *   - GET /assets/*               — Vite-built static assets
 *   - GET /favicon.ico, /robots.txt
 *
 * Everything else (UI shell, /sessions/*, /mcp/*, /__diagnostics, ...)
 * requires the cookie or `?key=<value>`.
 *
 * If `SITE_ACCESS_KEY` is unset, the middleware is a no-op (dev mode).
 */

import type { Context, MiddlewareHandler } from "hono";
import { setCookie, getCookie } from "hono/cookie";

const COOKIE_NAME = "ensemble_access";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

/** Paths that bypass the gate. Exact-match or prefix. */
function isPublic(path: string): boolean {
  if (path === "/health") return true;
  if (path === "/__login") return true;
  if (path === "/favicon.ico") return true;
  if (path === "/robots.txt") return true;
  if (path.startsWith("/assets/")) return true;
  return false;
}

/** Returns true if the request is for HTML (a browser nav), not JSON. */
function wantsHtml(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  return accept.includes("text/html");
}

/**
 * Middleware factory. Wraps the entire Hono app.
 *
 * If `SITE_ACCESS_KEY` is unset, returns a no-op middleware so dev /
 * test / CI environments don't need any extra config.
 */
export function siteAccessGate(): MiddlewareHandler {
  const KEY = process.env.SITE_ACCESS_KEY;
  if (!KEY) {
    return async (_, next) => {
      await next();
    };
  }
  return async (c, next) => {
    if (isPublic(c.req.path)) {
      await next();
      return;
    }

    // Query-string login: ?key=<value>. On match, set cookie + redirect.
    const queryKey = c.req.query("key");
    if (queryKey && queryKey === KEY) {
      setCookie(c, COOKIE_NAME, KEY, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: c.req.url.startsWith("https://"),
        maxAge: COOKIE_MAX_AGE,
      });
      // Strip the key from the URL.
      const url = new URL(c.req.url);
      url.searchParams.delete("key");
      return c.redirect(url.pathname + url.search, 302);
    }

    // Cookie-based.
    const cookie = getCookie(c, COOKIE_NAME);
    if (cookie === KEY) {
      await next();
      return;
    }

    // Failed. Browser → login form. JSON consumer → 401.
    if (wantsHtml(c)) {
      return c.html(loginPage(c.req.path), 401);
    }
    return c.json({ error: "unauthorized" }, 401);
  };
}

/** Inline minimal login form. Paper-aesthetic matches the rest of the app. */
function loginPage(returnTo: string): string {
  // Sanitize returnTo so an attacker can't redirect off-site.
  const safe =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Access required — ensemble</title>
<style>
  body { margin:0; background:#f6f3ec; color:#1c1a17;
    font-family:"Iowan Old Style", Palatino, Georgia, serif;
    display:flex; align-items:center; justify-content:center;
    min-height:100vh; font-size:16px; line-height:1.6; }
  .card { background:#fff; border:1px solid #c9bfa9; border-radius:4px;
    padding:32px 36px; max-width:380px; width:90%;
    box-shadow:0 4px 18px rgba(40,30,10,.05); }
  .brand { font-style:italic; font-weight:600; color:#6a4c1f;
    letter-spacing:.02em; font-size:13px; text-transform:uppercase;
    letter-spacing:.18em; margin-bottom:14px; }
  h1 { font-family:"Iowan Old Style",Palatino,serif; font-size:22px;
    margin:0 0 12px; font-weight:600; }
  p { color:#3a3631; font-size:14px; margin:8px 0 18px; }
  input { width:100%; padding:10px 12px; border:1px solid #c9bfa9;
    border-radius:3px; font:inherit; font-size:14px; background:#faf2db;
    color:#1c1a17; box-sizing:border-box; }
  input:focus { outline:1px solid #6a4c1f; }
  button { width:100%; margin-top:14px; padding:9px 14px;
    background:#6a4c1f; color:#faf2db; border:1px solid #6a4c1f;
    border-radius:3px; font:inherit; font-size:13px; font-weight:600;
    cursor:pointer; }
  button:hover { background:#8a6326; }
</style>
</head>
<body>
  <form class="card" method="get" action="${safe}">
    <div class="brand">ensemble</div>
    <h1>Access required.</h1>
    <p>Enter the access key to continue.</p>
    <input name="key" type="password" autofocus required autocomplete="off" />
    <button type="submit">Enter</button>
  </form>
</body>
</html>`;
}
