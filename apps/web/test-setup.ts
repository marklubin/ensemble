/**
 * Bun test preload: wires happy-dom as the global DOM, so React Testing
 * Library can render components without jsdom or a browser.
 *
 * Loaded via `preload` in `bunfig.toml`.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

// React testing library's auto-cleanup expects this env flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
