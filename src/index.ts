/**
 * @retenka/storefront-events-polyfill
 *
 * Drop-in polyfill that makes Shopify's official Standard Storefront Events
 * fire on themes that don't yet emit them natively.
 *
 * See https://github.com/webkraftz/storefront-events-polyfill for full docs.
 *
 * Public API:
 *   import { install } from "@retenka/storefront-events-polyfill";
 *   const handle = await install();
 *   // ...later:
 *   handle.uninstall();
 *
 * For most consumers the side-effect-importing `auto` entrypoint is simpler:
 *   import "@retenka/storefront-events-polyfill/auto";
 */

import { hasNativeStandardEventsSupport, isOptedOut } from "./capability.js";
import { installFetchInterceptor } from "./interceptors/fetch.js";
import { installXhrInterceptor } from "./interceptors/xhr.js";
import { installLifecycleWatchers } from "./lifecycle.js";
import { SHOPIFY_STANDARD_EVENTS_URL, loadStandardEventsModule } from "./runtime-loader.js";
import { type PolyfillHandle, type PolyfillOptions } from "./types.js";

export { SHOPIFY_STANDARD_EVENTS_URL } from "./runtime-loader.js";
export { hasNativeStandardEventsSupport, isOptedOut } from "./capability.js";
export type {
  AjaxCart,
  CartChangeContext,
  CartLineAction,
  CartLineUpdate,
  PolyfillHandle,
  PolyfillOptions,
  StandardEventsModule,
  StorefrontCart,
} from "./types.js";

const NOOP_HANDLE: PolyfillHandle = {
  uninstall: () => {},
  isDisabled: () => true,
};

/**
 * Installs the polyfill on the current document. Returns a handle the caller
 * can use to tear the polyfill down or inspect its state.
 *
 * Behavior:
 *  1. If running in a non-window environment (Node SSR, isolated worker), returns a no-op handle.
 *  2. If the host has opted out via `window.Shopify.RetenkaStandardEventsPolyfillDisabled = true`,
 *     returns a no-op handle.
 *  3. If the theme already supports standard events (library loaded or
 *     `updateCart` configured), returns a no-op handle.
 *  4. Otherwise loads `standard-events.js` from Shopify's CDN, installs fetch
 *     + XHR interceptors, installs lifecycle watchers, returns an active handle.
 *
 * The promise resolves once the standard-events module is loaded — calling
 * install once at script load and awaiting before any cart-mutating user
 * interaction ensures the polyfill is ready in time.
 */
export async function install(options: PolyfillOptions = {}): Promise<PolyfillHandle> {
  if (typeof window === "undefined") return NOOP_HANDLE;
  if (options.disabled === true || isOptedOut()) return NOOP_HANDLE;
  if (hasNativeStandardEventsSupport()) return NOOP_HANDLE;

  const module = await loadStandardEventsModule(
    options.standardEventsUrl ?? SHOPIFY_STANDARD_EVENTS_URL,
  );

  const dispatchContext = {
    module,
    target: options.target ?? window.document,
    fetch: options.fetch ?? window.fetch.bind(window),
  };

  const uninstallFetch = installFetchInterceptor(window, dispatchContext);
  const uninstallXhr = installXhrInterceptor(window, dispatchContext);

  let disabled = false;
  const teardown = (): void => {
    if (disabled) return;
    disabled = true;
    uninstallFetch();
    uninstallXhr();
    uninstallLifecycle();
  };

  const uninstallLifecycle = installLifecycleWatchers(window, {
    onCapabilityAppeared: teardown,
  });

  return {
    uninstall: teardown,
    isDisabled: () => disabled,
  };
}
