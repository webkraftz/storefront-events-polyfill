/**
 * Installs a window.fetch interceptor that watches for Shopify AJAX cart
 * mutation requests (/cart/add.js, /cart/change.js, /cart/update.js,
 * /cart/clear.js), parses the request body, and dispatches standard
 * storefront events for each mutation. Non-cart requests pass through
 * untouched with zero overhead.
 *
 * Scoped tightly per Shopify guidance: only cart endpoints are inspected,
 * the original fetch is always called, and the interceptor is fully
 * removable via the returned uninstall hook.
 */

import { type DispatchContext, dispatchIntents } from "../dispatcher.js";
import { matchCartEndpoint, parseCartRequest } from "../parsers/cart-request.js";

/** Removes the interceptor and restores window.fetch to its prior implementation. */
export type FetchInterceptorHandle = () => void;

/**
 * Installs the fetch interceptor on the given window. Returns the uninstall
 * function. Idempotent — multiple installs on the same window are safe (only
 * the first takes effect; subsequent calls return a no-op uninstall).
 */
export function installFetchInterceptor(win: Window, ctx: DispatchContext): FetchInterceptorHandle {
  if (typeof win.fetch !== "function") {
    // Environment without fetch — nothing to intercept. Return a no-op.
    return () => {};
  }

  // reason: fetch is `this-free` — we re-apply `win` as the receiver when
  // calling it, so the unbound reference is safe.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalFetch = win.fetch;
  const callOriginal: typeof fetch = (input, init) => originalFetch.call(win, input, init);
  const wrapped: typeof fetch = async (input, init) => {
    const url = extractUrl(input);
    if (!url || !matchCartEndpoint(url)) {
      return callOriginal(input, init);
    }

    const body = await snapshotRequestBody(input, init);
    const parsed = parseCartRequest(url, body);
    if (!parsed || parsed.intents.length === 0) {
      return callOriginal(input, init);
    }

    const tx = dispatchIntents(parsed, ctx);
    try {
      const response = await callOriginal(input, init);
      if (!response.ok) {
        tx.rejectWith(new Error(`Cart endpoint returned HTTP ${String(response.status)}`));
        return response;
      }
      // Fire-and-forget the cart fetch + promise resolution. The original
      // response is returned to the caller immediately so theme code that
      // awaits the fetch isn't blocked by our /cart.js follow-up.
      void tx.resolveWith();
      return response;
    } catch (err) {
      tx.rejectWith(err);
      throw err;
    }
  };

  // Use Object.defineProperty to swap — some environments (happy-dom, certain
  // production storefronts) define window.fetch as a non-writable accessor.
  // Plain assignment fails silently or throws there.
  if (!swapFetch(win, wrapped)) {
    // Property is non-configurable AND non-writable — bail with a no-op.
    return () => {};
  }

  return () => {
    if (win.fetch === wrapped) {
      swapFetch(win, originalFetch);
    }
  };
}

function swapFetch(win: Window, replacement: typeof fetch): boolean {
  try {
    Object.defineProperty(win, "fetch", {
      value: replacement,
      writable: true,
      configurable: true,
    });
    return true;
  } catch {
    return false;
  }
}

function extractUrl(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  // Best-effort fallback — some environments pass plain objects with `url`.
  const candidate = (input as { url?: unknown }).url;
  return typeof candidate === "string" ? candidate : null;
}

/**
 * Reads the request body without consuming the original. For Request objects
 * we clone before reading; for raw `init.body` we accept the body shapes
 * Shopify theme product forms actually ship:
 *
 *  - `string` — JSON or URL-encoded payload (e.g., manual `fetch('/cart/add.js', { body: JSON.stringify(...) })`)
 *  - `URLSearchParams` — manually-built form-encoded
 *  - `FormData` — the canonical Shopify product-form submit shape (every
 *    `<form action="/cart/add">` block emits this). Iterating FormData via
 *    `.forEach()` is non-destructive; the underlying body remains intact
 *    for the network call.
 *
 * Returns `undefined` for `Blob` / `ArrayBuffer` / `ReadableStream` since
 * those don't appear on real cart endpoints and reading them would risk
 * consuming the stream the browser is about to send.
 */
async function snapshotRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }

  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // Convert to URL-encoded string so the downstream parser (which already
    // handles URLSearchParams via `parseCartRequest`) can extract id / quantity.
    const params = new URLSearchParams();
    body.forEach((value, key) => {
      // FormData values can be string | File. Files don't appear in Shopify
      // cart endpoints — skip defensively so File.toString() doesn't pollute.
      if (typeof value === "string") {
        params.append(key, value);
      }
    });
    return params.toString();
  }
  return undefined;
}
