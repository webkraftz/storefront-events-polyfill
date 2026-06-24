/**
 * Lifecycle hooks for self-disabling the polyfill if native standard-events
 * support appears mid-page-lifetime. Without this, a theme that gets updated
 * (or that loads `@theme/standard-events` lazily after our install) would
 * cause double-firing of events.
 *
 * Strategy:
 *  - Re-check capability on `visibilitychange` (page becomes visible again)
 *  - Re-check on `pageshow` (back-forward cache restore)
 *  - When `hasNativeStandardEventsSupport()` flips true, call the provided
 *    teardown function (which removes our interceptors).
 *
 * Documented merchant-facing escape hatch: set
 * `window.Shopify.RetenkaStandardEventsPolyfillDisabled = true` before the
 * script loads to skip install entirely (see capability.ts).
 */

import { hasNativeStandardEventsSupport } from "./capability.js";

export interface LifecycleOptions {
  onCapabilityAppeared: () => void;
}

/**
 * Installs visibility + pageshow listeners that re-check capability and call
 * `onCapabilityAppeared` if it flips. Returns the uninstall function which
 * removes the listeners (called by the polyfill's main uninstall path).
 */
export function installLifecycleWatchers(win: Window, options: LifecycleOptions): () => void {
  if (typeof win.document === "undefined") {
    return () => {};
  }

  let fired = false;
  const check = (): void => {
    if (fired) return;
    if (hasNativeStandardEventsSupport()) {
      fired = true;
      options.onCapabilityAppeared();
    }
  };

  const onVisibility = (): void => {
    if (win.document.visibilityState === "visible") {
      check();
    }
  };

  win.document.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pageshow", check);

  return () => {
    win.document.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pageshow", check);
  };
}
