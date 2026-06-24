/**
 * Side-effect import that auto-installs the polyfill on load.
 *
 * Usage:
 *   <script type="module" src="https://cdn.jsdelivr.net/npm/@retenka/storefront-events-polyfill@1/dist/auto.js"></script>
 *
 *   // or, in app code:
 *   import "@retenka/storefront-events-polyfill/auto";
 *
 * For programmatic control over install timing / options / teardown, use the
 * main entrypoint:
 *   import { install } from "@retenka/storefront-events-polyfill";
 */

import { install } from "./index.js";

declare global {
  interface Window {
    /**
     * Set by the auto-install entrypoint. Holds the installed polyfill handle
     * (or null if install was a no-op). Consumers can call
     * `window.__retenkaStandardEventsPolyfill?.uninstall()` to tear it down.
     */
    __retenkaStandardEventsPolyfill?: {
      uninstall: () => void;
      isDisabled: () => boolean;
    } | null;
  }
}

if (typeof window !== "undefined") {
  void install()
    .then((handle) => {
      window.__retenkaStandardEventsPolyfill = handle;
    })
    .catch((err: unknown) => {
      window.__retenkaStandardEventsPolyfill = null;
      // Surface failures without breaking the page.
      console.warn("[@retenka/storefront-events-polyfill] install failed:", err);
    });
}
