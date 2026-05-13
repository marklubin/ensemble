/**
 * Bun-test preload: register happy-dom as the global DOM.
 *
 * Wired via `bunfig.toml` (test.preload) in `apps/web/` AND imported
 * defensively from each `*.test.tsx` so the tests still work when run
 * from the repo root (which doesn't see the app-local bunfig).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

export function ensureDom(): void {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ url: "http://localhost:5173/" });
  }
}

ensureDom();
