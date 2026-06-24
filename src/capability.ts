/**
 * Capability detection for "does this theme already emit standard storefront
 * events natively?" Used at install time to skip polyfill installation, and at
 * runtime to self-disable if native support appears mid-page-lifetime.
 *
 * Two signals are considered authoritative (per Shopify-AI conv
 * `conv_1782304665082_rp96uj5yj`):
 *
 *  1. `window.Shopify.StandardEvents` — the canonical exposed library, set by
 *     themes that follow the documented "Loading the library" snippet at
 *     https://shopify.dev/docs/storefronts/themes/best-practices/standard-events
 *
 *  2. `Shopify.actions.updateCart.isDefault() === false` — the theme has called
 *     `.configure(...)` on the updateCart action, which auto-emits standard
 *     events when the action runs. Default (`true`) does NOT guarantee absence
 *     of events but also doesn't guarantee presence — treat as "unknown" and
 *     fall through to install.
 *
 * Heuristic — neither signal is by itself a guarantee. The check is
 * "conservative skip": if either is positive, we assume native support and
 * skip the polyfill, accepting the small risk that a theme might load the
 * library without dispatching events (extremely unlikely in practice).
 */

import { type StandardEventsModule } from "./types.js";

/**
 * Returns true when the current page appears to support standard storefront
 * events without our polyfill. The polyfill SHOULD NOT install when this is
 * true, and SHOULD self-disable if this flips to true mid-lifetime.
 */
export function hasNativeStandardEventsSupport(): boolean {
  return libraryLoaded() || updateCartConfigured();
}

/** Tighter check — has the canonical events library been loaded and exposed? */
export function libraryLoaded(): boolean {
  const lib = readStandardEventsLibrary();
  if (!lib) return false;
  return (
    typeof lib.CartLinesUpdateEvent === "function" &&
    typeof lib.CartLinesUpdateEvent.createPromise === "function" &&
    typeof lib.CartLinesUpdateEvent.createCartFromAjaxResponse === "function"
  );
}

/**
 * Has the theme overridden `Shopify.actions.updateCart` via `.configure(...)`?
 * When `isDefault()` returns `false`, the actions runtime auto-emits standard
 * events whenever the configured action runs. We treat this as "theme is
 * handling events for me".
 *
 * Note: the inverse is NOT true. `isDefault() === true` means "theme didn't
 * call .configure" — which is the case for every theme today that uses raw
 * AJAX cart endpoints. Those themes need the polyfill.
 */
export function updateCartConfigured(): boolean {
  const updateCart = readActionsRuntime()?.updateCart;
  if (!updateCart || typeof updateCart.isDefault !== "function") return false;
  try {
    return updateCart.isDefault() === false;
  } catch {
    return false;
  }
}

/** Has the platform actions runtime been injected (every Liquid storefront has it)? */
export function actionsRuntimeAvailable(): boolean {
  const runtime = readActionsRuntime();
  return !!runtime && typeof runtime.updateCart === "function";
}

/** Reads `window.Shopify.StandardEvents` if present. */
export function readStandardEventsLibrary(): StandardEventsModule | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Shopify?.StandardEvents;
}

/** Reads `window.Shopify.actions` if present. */
function readActionsRuntime():
  | NonNullable<NonNullable<typeof window.Shopify>["actions"]>
  | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Shopify?.actions;
}

/**
 * Has the host opted out via `window.Shopify.RetenkaStandardEventsPolyfillDisabled = true`?
 * Checked before install — if `true`, polyfill returns a no-op handle.
 */
export function isOptedOut(): boolean {
  if (typeof window === "undefined") return true;
  return window.Shopify?.RetenkaStandardEventsPolyfillDisabled === true;
}
