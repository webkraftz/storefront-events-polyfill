/**
 * Capability detection for "does this theme already emit standard storefront
 * events natively?" Used at install time to skip polyfill installation, and at
 * runtime to self-disable if native support appears mid-page-lifetime.
 *
 * Only ONE signal is authoritative for "events fire natively on cart writes":
 *
 *   `Shopify.actions.updateCart.isDefault() === false` — the theme has called
 *   `.configure(...)` on the updateCart action, which auto-emits standard
 *   events whenever the configured action runs.
 *
 * Library presence (`window.Shopify.StandardEvents`) is **NOT** sufficient.
 * Shopify auto-injects the StandardEvents runtime on Plus tier stores even
 * when the theme is still using raw AJAX cart endpoints (`fetch('/cart/add.js')`)
 * that do NOT dispatch any events. The library was originally part of the
 * skip-install heuristic; field reports from `plus-webkraftz-com` 2026-06-25
 * proved this assumption wrong — the polyfill silently no-op'd while the
 * theme's cart mutations went unintercepted. `libraryLoaded()` remains
 * exported (the loader uses it to decide whether to re-fetch the runtime).
 *
 * Default `isDefault() === true` means "theme didn't call .configure" — the
 * case for every theme using legacy AJAX cart endpoints today. Those themes
 * need the polyfill.
 */

import { type StandardEventsModule } from "./types.js";

/**
 * Returns true when the current page appears to dispatch standard storefront
 * cart events natively. The polyfill SHOULD NOT install when this is true.
 * Only positive when the theme has configured a non-default updateCart action
 * — library-loaded alone is not a reliable signal (see file docblock).
 */
export function hasNativeStandardEventsSupport(): boolean {
  return updateCartConfigured();
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
